// Copyright (c) 2026 Sub Rosa contributors
// settlement-guard.ts
//
// In-memory duplicate-settlement suppression for the keeper, plus the round
// contract's own settle/void rules so the keeper never submits a transaction
// the contract would revert.
//
// A keeper may observe the same round across many polling cycles. Without
// this guard it would attempt to settle an already-submitted (or terminal)
// round on every tick. The guard tracks a small per-round state machine:
//
//   pending  →  submitted  (settle() called, waiting for confirmation)
//   pending  →  terminal   (round already Settled / Voided / irreversible)
//   submitted → terminal   (confirmation arrived)
//   submitted → pending    (network error — retryable, NOT permanently suppressed)
//
// Only "pending" rounds are allowed to proceed to settlement. Submitted and
// terminal rounds are skipped with a structured log event that carries a
// `skippedDuplicateReason` field so it is searchable in structured logs.
//
// On top of that state machine the guard mirrors the contract rules in
// `contracts/round/src/lib.rs` — status guards, winner selection, and the
// refund set — against the keeper's local view of a round. When the local
// view would produce a settle or a void the contract rejects (or cannot be
// verified at all), the guard refuses the submission and records a typed
// reason the status endpoint shows.

import type { SubRosaClient } from "@sub-rosa/sdk";
import { systemClock, type Clock } from "@sub-rosa/time";

export type SettlementGuardStatus = "pending" | "submitted" | "terminal";

/** Lifecycle action the keeper asked the guard to authorize. */
export type SettlementAction = "settle" | "void";

export interface SettlementGuardEntry {
  roundId: bigint;
  status: SettlementGuardStatus;
  /** ISO-8601 timestamp of the last status change. */
  updatedAt: string;
  /** Human-readable reason recorded when the entry was last updated. */
  reason: string;
  /** Most recent contract-rule refusal, if the guard declined to submit. */
  skip?: GuardSkipRecord;
}

/** Structured event emitted when a duplicate settlement is suppressed. */
export interface DuplicateSkipEvent {
  event: "settlement_skipped_duplicate";
  roundId: string;
  /** The guard status that caused the skip: "submitted" or "terminal". */
  skippedDuplicateReason: SettlementGuardStatus;
  lastReason: string;
}

/** Matches `VOID_GRACE` in the Round contract (seconds after reveal_deadline). */
export const VOID_GRACE_SECONDS = 3600;

/** Unix seconds after which the contract accepts a void for this round. */
export function voidAfter(revealDeadline: number): number {
  return revealDeadline + VOID_GRACE_SECONDS;
}

/** Clearing rule tag as the contract records it on the round. */
export type ClearingRuleTag = "HighestBid" | "LowestBid";

/**
 * One bidder as the keeper's local view knows it. `escrow: null` means the
 * bid state could not be read, so the refund the contract would pay this
 * bidder cannot be predicted.
 */
export interface GuardBidderState {
  bidder: string;
  /** Escrow locked at commit; null when the state read failed. */
  escrow: bigint | null;
  /** Revealed value; null when the bid is not revealed (or unreadable). */
  revealedValue: bigint | null;
  /** True once the contract has already paid this bidder. */
  settled: boolean;
}

/**
 * The keeper's local snapshot of a round, exactly as it will be submitted.
 * Every field maps to state the contract reads when it evaluates `settle` or
 * `void`.
 */
export interface RoundSettlementView {
  roundId: string;
  /** On-chain status tag: Open | Revealing | Cleared | Settled | Voided. */
  status: string;
  clearingRule: ClearingRuleTag;
  /** Reveal deadline in unix seconds. */
  revealDeadline: number;
  /** Keeper clock in unix seconds, used for the void grace window. */
  nowSeconds: number;
  /** The part of the ordered bidder index the keeper actually read. */
  bidders: readonly GuardBidderState[];
  /** Bidder count the contract reports for the round. */
  bidderTotal: number;
  /** Winner recorded on-chain by `clear()`; null while nobody won. */
  winner: string | null;
  /** Winning bid recorded on-chain by `clear()`; null while not cleared. */
  winningBid: bigint | null;
}

/**
 * Typed refusals. The names mirror what the contract would have rejected:
 * `not_cleared` is `Error::NotCleared`, `void_not_open` is `Error::NotVoidable`,
 * and so on — the guard simply decides before paying for a failed transaction.
 */
export type ContractSkipReason =
  | "already_settled"
  | "round_voided"
  | "not_cleared"
  | "missing_winner"
  | "bidder_page_incomplete"
  | "refund_missing"
  | "winner_mismatch"
  | "void_not_open"
  | "void_grace_not_elapsed";

/** Structured event emitted when a submission fails a contract rule. */
export interface ContractSkipEvent {
  event: "settlement_skipped_contract";
  roundId: string;
  action: SettlementAction;
  reason: ContractSkipReason;
  detail: string;
}

export type SettlementSkipEvent = DuplicateSkipEvent | ContractSkipEvent;

/** What the contract will move if it accepts this action. */
export interface SettlementPlan {
  action: SettlementAction;
  /** Winning bidder for a settle; null for a void. */
  winner: string | null;
  /** Escrow the contract pays the operator (0 for a void). */
  operatorPayout: bigint;
  /** Winner surplus returned on settle (0 for a void). */
  winnerSurplus: bigint;
  /** Every other escrow the contract returns, in bidder index order. */
  refunds: Array<{ bidder: string; amount: bigint }>;
}

export type ContractDecision =
  | { allowed: true; plan: SettlementPlan }
  | { allowed: false; event: ContractSkipEvent };

export type SettlementCheck =
  | { allowed: true; plan: SettlementPlan }
  | { allowed: false; event: SettlementSkipEvent };

/** Typed refusal, stored on the guard entry and served by the status API. */
export interface GuardSkipRecord {
  action: SettlementAction;
  reason: ContractSkipReason;
  detail: string;
  /** ISO-8601 timestamp of the refusal. */
  at: string;
}

export interface SettlementGuard {
  /**
   * Check whether settlement may proceed for this round.
   *
   * Returns `{ allowed: true }` when the round is "pending".
   * Returns `{ allowed: false, event }` when the round is "submitted" or
   * "terminal", so the caller can log the structured event.
   */
  canSettle(
    roundId: bigint,
  ): { allowed: true } | { allowed: false; event: DuplicateSkipEvent };

  /**
   * Contract-rule check before dispatching a settle: duplicate suppression
   * first, then the winner/refund rules the contract enforces.
   *
   * A refusal records a typed reason on the entry (`getEntry(...).skip`) so
   * the status endpoint can show why nothing was submitted.
   */
  checkSettle(view: RoundSettlementView): SettlementCheck;

  /** Contract-rule check before dispatching a void. */
  checkVoid(view: RoundSettlementView): SettlementCheck;

  /** Call immediately before dispatching the settle transaction. */
  markSubmitted(roundId: bigint): void;

  /**
   * Call when the settle transaction is confirmed (or the round is already
   * in a terminal on-chain state such as Settled or Voided).
   */
  markTerminal(roundId: bigint, reason: string): void;

  /**
   * Call when a settle attempt fails with a retryable error (e.g. network
   * timeout). The entry reverts to "pending" so the next polling cycle can
   * retry. Failed work is never permanently suppressed.
   */
  markRetryable(roundId: bigint, reason: string): void;

  /** Read the current entry for a round (useful in tests and dry-run logging). */
  getEntry(roundId: bigint): SettlementGuardEntry | undefined;

  /** All tracked entries, ordered by insertion. */
  entries(): SettlementGuardEntry[];
}

/** One page of the bidder index at a time, so a truncated read is visible. */
const BIDDER_PAGE_SIZE = 100;

/**
 * The winner the contract would pick from these revealed bids: only revealed,
 * positive, fully-read bids participate, and the first bidder wins a tie —
 * exactly the loop in `SubRosaRound::clear`.
 */
export function expectedWinner(
  view: RoundSettlementView,
): { bidder: string; value: bigint } | null {
  let best: { bidder: string; value: bigint } | null = null;
  for (const state of view.bidders) {
    if (state.escrow === null || state.revealedValue === null) continue;
    if (state.revealedValue <= 0n) continue;
    if (best === null) {
      best = { bidder: state.bidder, value: state.revealedValue };
      continue;
    }
    const better =
      view.clearingRule === "LowestBid"
        ? state.revealedValue < best.value
        : state.revealedValue > best.value;
    if (better) best = { bidder: state.bidder, value: state.revealedValue };
  }
  return best;
}

/**
 * The escrow the contract returns for a settle, mirroring `SubRosaRound::settle`
 * and the winner's surplus: the winner pays `winningBid` to the operator and
 * gets `escrow - winningBid` back, every other bidder gets their escrow.
 */
export function settleRefunds(
  view: RoundSettlementView,
  winner: string,
  winningBid: bigint,
): { refunds: Array<{ bidder: string; amount: bigint }>; winnerSurplus: bigint } {
  const refunds: Array<{ bidder: string; amount: bigint }> = [];
  let winnerSurplus = 0n;
  for (const state of view.bidders) {
    if (state.settled || state.escrow === null) continue;
    if (state.bidder === winner) {
      const surplus = state.escrow - winningBid;
      winnerSurplus = surplus > 0n ? surplus : 0n;
    } else if (state.escrow > 0n) {
      refunds.push({ bidder: state.bidder, amount: state.escrow });
    }
  }
  return { refunds, winnerSurplus };
}

/** The escrow `SubRosaRound::void` returns: every unsettled escrow, in order. */
export function voidRefunds(
  view: RoundSettlementView,
): Array<{ bidder: string; amount: bigint }> {
  const refunds: Array<{ bidder: string; amount: bigint }> = [];
  for (const state of view.bidders) {
    if (state.settled || state.escrow === null) continue;
    if (state.escrow > 0n) refunds.push({ bidder: state.bidder, amount: state.escrow });
  }
  return refunds;
}

function refuse(
  view: RoundSettlementView,
  action: SettlementAction,
  reason: ContractSkipReason,
  detail: string,
): ContractDecision {
  return {
    allowed: false,
    event: {
      event: "settlement_skipped_contract",
      roundId: view.roundId,
      action,
      reason,
      detail,
    },
  };
}

/**
 * Would the contract accept a settle of this view? Mirrors the checks in
 * `SubRosaRound::settle` (status, then winner) and adds the two completeness
 * checks a local view needs before it can promise the refund set.
 */
export function evaluateSettle(view: RoundSettlementView): ContractDecision {
  if (view.status === "Settled") {
    return refuse(view, "settle", "already_settled", "the contract rejects settle on a Settled round");
  }
  if (view.status === "Voided") {
    return refuse(
      view,
      "settle",
      "round_voided",
      "the contract rejects settle on a Voided round (escrow was refunded at clear)",
    );
  }
  if (view.status !== "Cleared") {
    return refuse(view, "settle", "not_cleared", `the contract rejects settle while the round is ${view.status}`);
  }
  if (view.winner === null) {
    return refuse(view, "settle", "missing_winner", "the contract rejects settle when no bid won (NoValidBids)");
  }
  if (view.bidders.length < view.bidderTotal) {
    return refuse(
      view,
      "settle",
      "bidder_page_incomplete",
      `read ${view.bidders.length} of ${view.bidderTotal} bidders; the refund set would be incomplete`,
    );
  }
  for (const state of view.bidders) {
    if (state.escrow === null) {
      return refuse(
        view,
        "settle",
        "refund_missing",
        `escrow for ${state.bidder} is unreadable; its refund cannot be verified`,
      );
    }
  }
  const expected = expectedWinner(view);
  const onChainBid = view.winningBid;
  if (expected === null || expected.bidder !== view.winner || onChainBid === null || expected.value !== onChainBid) {
    return refuse(
      view,
      "settle",
      "winner_mismatch",
      `local winner ${expected ? `${expected.bidder}=${expected.value}` : "none"} does not match ` +
        `on-chain winner ${view.winner}=${onChainBid ?? "unset"}`,
    );
  }
  const { refunds, winnerSurplus } = settleRefunds(view, view.winner, onChainBid);
  return {
    allowed: true,
    plan: {
      action: "settle",
      winner: view.winner,
      operatorPayout: onChainBid,
      winnerSurplus,
      refunds,
    },
  };
}

/**
 * Would the contract accept a void of this view? Mirrors the checks in
 * `SubRosaRound::void`: the round must still be Open, the grace window after
 * the reveal deadline must have elapsed, and — as for settle — the local view
 * must cover the whole bidder index so the refund set is complete.
 */
export function evaluateVoid(view: RoundSettlementView): ContractDecision {
  if (view.status === "Voided") {
    return refuse(view, "void", "round_voided", "the contract rejects void on a Voided round");
  }
  if (view.status === "Settled") {
    return refuse(view, "void", "already_settled", "the contract rejects void on a Settled round");
  }
  if (view.status !== "Open") {
    return refuse(
      view,
      "void",
      "void_not_open",
      `the contract rejects void while the round is ${view.status} (void needs Open)`,
    );
  }
  const opensAt = voidAfter(view.revealDeadline);
  if (view.nowSeconds <= opensAt) {
    return refuse(
      view,
      "void",
      "void_grace_not_elapsed",
      `void opens after ${opensAt} (reveal deadline ${view.revealDeadline} + ${VOID_GRACE_SECONDS}s grace)`,
    );
  }
  if (view.bidders.length < view.bidderTotal) {
    return refuse(
      view,
      "void",
      "bidder_page_incomplete",
      `read ${view.bidders.length} of ${view.bidderTotal} bidders; the refund set would be incomplete`,
    );
  }
  for (const state of view.bidders) {
    if (state.escrow === null) {
      return refuse(
        view,
        "void",
        "refund_missing",
        `escrow for ${state.bidder} is unreadable; its refund cannot be verified`,
      );
    }
  }
  return {
    allowed: true,
    plan: {
      action: "void",
      winner: null,
      operatorPayout: 0n,
      winnerSurplus: 0n,
      refunds: voidRefunds(view),
    },
  };
}

/** Human-readable line for logs, store `lastError` fields, and skip lists. */
export function describeSettlementSkip(event: SettlementSkipEvent): string {
  if (event.event === "settlement_skipped_duplicate") {
    return `duplicate ${event.skippedDuplicateReason}: ${event.lastReason}`;
  }
  return `${event.action} refused (${event.reason}): ${event.detail}`;
}

/**
 * Build the local view the guard evaluates, straight from the contract.
 *
 * The bidder index is read page by page so a truncated read stays visible as
 * `bidders.length < bidderTotal`, and a bid state that cannot be read is kept
 * as `escrow: null` instead of being dropped — both are refusals, never a
 * silently smaller refund set. Index or page failures propagate; a bid state
 * failure is recorded as unread so the guard can refuse with a typed reason.
 */
export async function readSettlementView(
  reader: Pick<SubRosaClient, "getRound" | "getBiddersPage" | "getBidState">,
  roundId: bigint,
  nowSeconds: number,
): Promise<RoundSettlementView> {
  const round = await reader.getRound(roundId);
  let total = round.bidders?.length ?? 0;
  const index: string[] = [];
  try {
    let cursor = 0;
    for (;;) {
      const page = await reader.getBiddersPage(roundId, cursor, BIDDER_PAGE_SIZE);
      total = page.total;
      for (const bidder of page.data) index.push(bidder);
      if (page.next_cursor === 0 || index.length >= total) break;
      cursor = page.next_cursor;
    }
  } catch {
    // Keep the bidders read so far: an incomplete page must be refused, not
    // silently rounded up to a refund set the keeper never looked at.
  }

  const bidders: GuardBidderState[] = [];
  for (const bidder of index) {
    try {
      const state = await reader.getBidState(roundId, bidder);
      bidders.push({
        bidder,
        escrow: BigInt(state.escrow),
        revealedValue: state.revealed_value == null ? null : BigInt(state.revealed_value),
        settled: Boolean(state.settled),
      });
    } catch {
      bidders.push({ bidder, escrow: null, revealedValue: null, settled: false });
    }
  }

  return {
    roundId: roundId.toString(),
    status: round.status.tag,
    clearingRule: round.clearing_rule?.tag === "LowestBid" ? "LowestBid" : "HighestBid",
    revealDeadline: Number(round.reveal_deadline),
    nowSeconds,
    bidders,
    bidderTotal: total,
    winner: round.winner ?? null,
    winningBid: round.winning_bid == null ? null : BigInt(round.winning_bid),
  };
}

function now(clock: Clock): string {
  return clock.toISOString();
}

/**
 * Create a fresh in-memory SettlementGuard.
 *
 * The guard is intentionally stateless across process restarts — persistence
 * would add complexity and a keeper restart is already a safe recovery action
 * because it re-reads on-chain state before deciding whether to settle.
 */
export function createSettlementGuard(clock: Clock = systemClock): SettlementGuard {
  const entries = new Map<bigint, SettlementGuardEntry>();

  function getOrCreate(roundId: bigint): SettlementGuardEntry {
    if (!entries.has(roundId)) {
      entries.set(roundId, {
        roundId,
        status: "pending",
        updatedAt: now(clock),
        reason: "initial",
      });
    }
    return entries.get(roundId)!;
  }

  function canSettle(
    roundId: bigint,
  ): { allowed: true } | { allowed: false; event: DuplicateSkipEvent } {
    const entry = getOrCreate(roundId);
    if (entry.status === "pending") {
      return { allowed: true };
    }
    return {
      allowed: false,
      event: {
        event: "settlement_skipped_duplicate",
        roundId: roundId.toString(),
        skippedDuplicateReason: entry.status,
        lastReason: entry.reason,
      },
    };
  }

  function check(action: SettlementAction, view: RoundSettlementView): SettlementCheck {
    const roundId = BigInt(view.roundId);
    const entry = getOrCreate(roundId);

    // Duplicate suppression first: a round already in flight or already done
    // is refused before any contract rule is evaluated.
    const duplicate = canSettle(roundId);
    if (!duplicate.allowed) return duplicate;

    const decision = action === "settle" ? evaluateSettle(view) : evaluateVoid(view);
    if (decision.allowed) {
      entry.skip = undefined;
      return decision;
    }
    entry.skip = {
      action,
      reason: decision.event.reason,
      detail: decision.event.detail,
      at: now(clock),
    };
    entry.updatedAt = now(clock);
    entry.reason = `${action} refused: ${decision.event.reason}`;
    // A refusal that says the round is already settled or already voided is
    // also a statement that the round is done — record it as terminal so the
    // keeper stops scheduling work for it, while `skip` keeps the typed reason.
    if (decision.event.reason === "already_settled" || decision.event.reason === "round_voided") {
      entry.status = "terminal";
    }
    return decision;
  }

  return {
    canSettle,

    checkSettle(view) {
      return check("settle", view);
    },

    checkVoid(view) {
      return check("void", view);
    },

    markSubmitted(roundId) {
      const entry = getOrCreate(roundId);
      entry.status = "submitted";
      entry.updatedAt = now(clock);
      entry.reason = "settle tx dispatched";
      entry.skip = undefined;
    },

    markTerminal(roundId, reason) {
      const entry = getOrCreate(roundId);
      entry.status = "terminal";
      entry.updatedAt = now(clock);
      entry.reason = reason;
      // `skip` is kept: it is the last contract-rule refusal for this round,
      // which is exactly what the status endpoint should keep showing.
    },

    markRetryable(roundId, reason) {
      const entry = getOrCreate(roundId);
      // Retryable failures go back to pending so the next cycle can retry.
      // This explicitly does NOT permanently suppress the work.
      entry.status = "pending";
      entry.updatedAt = now(clock);
      entry.reason = `retryable: ${reason}`;
    },

    getEntry(roundId) {
      return entries.get(roundId);
    },

    entries() {
      return [...entries.values()];
    },
  };
}
