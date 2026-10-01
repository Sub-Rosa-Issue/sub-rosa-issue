import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
// Permissionless reveal keeper.
//
// Once Drand round R is published, *anyone* can force a sealed round open and
// reveal every bid — no operator, no bidder cooperation. This keeper does
// exactly that, idempotently:
//
//   1. wait until round R is available,
//   2. open the reveal window with R's real Drand signature (verified on-chain),
//   3. read the deterministic bidder index, decrypt each seal with R,
//   4. submit each reveal.
//
// Every step tolerates "already done" states (another keeper, or the operator,
// may have acted first) by checking on-chain state first and treating the
// matching contract errors as skips rather than failures. No relayer, no agent,
// no mock — just the SDK over real RPC and the live Drand beacon.

import type { SubRosaClient } from "@sub-rosa/sdk";
import { openBid, fetchRoundSignature, type DrandClient } from "@sub-rosa/tlock";
import { compareRoundIds } from "./store.js";
import {
  describeSettlementSkip,
  evaluateVoid,
  readSettlementView,
  voidAfter,
  type ContractSkipEvent,
  type RoundSettlementView,
  type SettlementGuard,
  type SettlementSkipEvent,
} from "./settlement-guard.js";
import {
  resolveTimeContext,
  systemTime,
  type PartialTimeContext,
  type TimeContext,
} from "@sub-rosa/time";

export type KeeperLogger = (msg: string) => void;

export interface KeeperDeps {
  /** A funded signer. The keeper role is permissionless — any account works. */
  sdk: SubRosaClient;
  drand: DrandClient;
  log?: KeeperLogger;
  /** Max seconds to wait for round R. Default 0: act only if R is already out. */
  maxWaitSeconds?: number;
  /** Poll cadence while waiting for R (ms). Default 3000. */
  pollMs?: number;
  /** Injectable wall clock and scheduler. Default: systemTime. */
  time?: PartialTimeContext;
  /**
   * Durable watch cursor. When present, steps it records as complete are not
   * re-broadcast — that is what stops a restart from resettling a round.
   */
  checkpoint?: WatchCheckpoint;
}

export interface SkipRecord {
  bidder: string;
  reason: string;
}

export interface KeeperResult {
  roundId: bigint;
  finalStatus: string;
  /** True if this run moved the round into Revealing (vs. it was already open). */
  openedReveal: boolean;
  revealed: string[];
  skipped: SkipRecord[];
}

// Contract error codes that mean "someone already did this" — safe to skip.
const IDEMPOTENT_OPEN = ["RevealAlreadyOpen", "WrongStatus", "AlreadyCleared"];
const IDEMPOTENT_REVEAL = ["AlreadyRevealed"];

/** Skip reasons that still mean "this bid is revealed on chain". */
const REVEALED_REASONS = new Set(["already revealed", "already revealed (race)"]);

export function errorName(e: unknown): string {
  return normalizeError(e).message;
}

export function errorMatches(e: unknown, names: string[]): boolean {
  const diagnostic = JSON.stringify(normalizeError(e));
  return names.some((name) => diagnostic.includes(name));
}

/**
 * Narrow a guard decision to a contract-rule refusal. A duplicate skip is
 * already reported by the settlement indicator, so only the typed contract
 * reason is carried on the close/void result.
 */
function contractRefusal(
  event: SettlementSkipEvent,
): ContractSkipEvent | undefined {
  return event.event === "settlement_skipped_contract" ? event : undefined;
}

function keeperTime(deps: KeeperDeps): TimeContext {
  return resolveTimeContext(systemTime, deps.time);
}

/**
 * True when the durable checkpoint says this step already completed and must not
 * be broadcast again. Only skip-eligible steps qualify: `open-reveal` is derived
 * from the on-chain status, so trusting the cursor there could strand a round.
 */
function stepAlreadyDone(
  deps: KeeperDeps,
  roundId: bigint,
  step: KeeperStep,
): boolean {
  if (!deps.checkpoint || !CHECKPOINT_SKIP_STEPS.includes(step)) return false;
  return deps.checkpoint.isComplete(roundId, step);
}

/** Record a completed step in the durable cursor (no-op without a checkpoint). */
function recordStep(
  deps: KeeperDeps,
  roundId: bigint,
  step: KeeperStep,
  transactionHash?: string | null,
): void {
  deps.checkpoint?.markComplete(roundId, step, transactionHash);
}

/** Resolve a durable in-flight hash before the caller builds another tx. */
async function recoverBeforeRetry(
  deps: KeeperDeps,
  roundId: bigint,
  operation: string,
  step: KeeperStep,
  discriminator?: string,
): Promise<boolean> {
  if (typeof deps.sdk.reconcileSubmission !== "function") return false;
  const recovered = await deps.sdk.reconcileSubmission({
    operation,
    roundId: roundId.toString(),
    ...(discriminator ? { discriminator } : {}),
  });
  if (!recovered) return false;
  if (recovered.state === "pending") {
    throw new Error(`round ${roundId} ${operation} transaction ${recovered.hash} is still pending`);
  }
  if (recovered.state === "failed") {
    throw new Error(`round ${roundId} ${operation} transaction ${recovered.hash} definitively failed`);
  }
  if (recovered.state === "confirmed") {
    // Each reveal journal entry is per bidder; the aggregate cursor is only
    // complete after every bidder has been checked in this pass.
    if (step !== "reveal" || !discriminator) {
      recordStep(deps, roundId, step, recovered.hash);
    }
    return true;
  }
  // An expired hash is terminal; exactly this pass may now build one replacement.
  return false;
}

/** Wait until Drand round R should be published. Returns false if R is still in
 *  the future after `maxWaitSeconds`. */
export async function waitForRound(
  deps: KeeperDeps,
  round: number,
): Promise<boolean> {
  const { drand, log = () => {}, maxWaitSeconds = 0, pollMs = 3000 } = deps;
  const { clock, scheduler } = keeperTime(deps);
  const info = await drand.chain().info();
  const publishAtMs = (info.genesis_time + info.period * round) * 1000;
  const giveUpAtMs = clock.nowMs() + maxWaitSeconds * 1000;

  while (clock.nowMs() < publishAtMs) {
    if (clock.nowMs() >= giveUpAtMs) return false;
    const remainS = Math.ceil((publishAtMs - clock.nowMs()) / 1000);
    log(`waiting ~${remainS}s for Drand round ${round}…`);
    await scheduler.sleep(Math.min(pollMs, Math.max(250, publishAtMs - clock.nowMs())));
  }
  return true;
}

/** Run one full keeper pass over a round: open (if needed) + reveal all. */
export async function keepRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<KeeperResult> {
  const { sdk, drand, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: KeeperResult = {
    roundId: rid,
    finalStatus: "",
    openedReveal: false,
    revealed: [],
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} R=${round.reveal_round}`);

  // ── Phase A: open the reveal window with R's real Drand signature ──────
  if (round.status.tag === "Open") {
    const R = Number(round.reveal_round);
    const available = await waitForRound(deps, R);
    if (!available) {
      log(`Drand round ${R} not published yet; nothing to open this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    // R's wall-clock time has arrived, but an API replica may lag a beat before
    // it serves the beacon — retry briefly rather than bailing.
    const pollMs = deps.pollMs ?? 3000;
    let signature: Uint8Array | undefined;
    const { scheduler } = keeperTime(deps);
    for (let attempt = 0; attempt < 5 && !signature; attempt++) {
      try {
        signature = await fetchRoundSignature(drand, R);
      } catch (e) {
        log(`Drand round ${R} not servable yet (try ${attempt + 1}/5): ${errorName(e)}`);
        await scheduler.sleep(pollMs);
      }
    }
    if (!signature) {
      log(`gave up fetching Drand round ${R} this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    const recoveredOpen = await recoverBeforeRetry(deps, rid, "open_reveal", "open-reveal");
    if (recoveredOpen) {
      log(`open_reveal transaction recovered as confirmed for round ${rid}`);
    } else {
      try {
        await sdk.openReveal(rid, signature);
        result.openedReveal = true;
        log(`open_reveal OK (round ${rid} via Drand R=${R})`);
      } catch (e) {
        if (errorMatches(e, IDEMPOTENT_OPEN)) {
          log(`open_reveal already done (${errorName(e)}); continuing`);
        } else {
          throw e;
        }
      }
    }
    // The reveal window is open from here on (we opened it, or the contract told
    // us it already was) — advance the cursor before revealing any bid.
    if (!recoveredOpen) recordStep(deps, rid, "open-reveal");
    round = await sdk.getRound(rid);
  }

  // ── Phase B: decrypt every seal and reveal it ─────────────────────────
  if (round.status.tag === "Revealing") {
    if (stepAlreadyDone(deps, rid, "reveal")) {
      // A previous process already revealed every bid and recorded it. Re-decrypting
      // and re-broadcasting would be pure waste, so trust the cursor.
      log(`reveals skipped: checkpoint records every bid revealed`);
      result.skipped.push({ bidder: "*", reason: "reveals complete (checkpoint)" });
    } else {
      const bidders: string[] = [];
      for await (const addr of sdk.bidders(rid)) bidders.push(addr);
      log(`revealing ${bidders.length} bidder(s)`);

      for (const bidder of bidders) {
        const recoveredReveal = await recoverBeforeRetry(deps, rid, "reveal", "reveal", bidder);
        if (recoveredReveal) {
          result.revealed.push(bidder);
          log(`reveal transaction recovered as confirmed for ${bidder}`);
          continue;
        }
        let state;
        try {
          state = await sdk.getBidState(rid, bidder);
        } catch (e) {
          result.skipped.push({ bidder, reason: `state read failed: ${errorName(e)}` });
          continue;
        }
        // Option<i128> None decodes as null/undefined; a revealed bid is a bigint.
        if (state.revealed_value != null) {
          result.skipped.push({ bidder, reason: "already revealed" });
          continue;
        }

        const seal = await sdk.getSeal(rid, bidder);
        if (!seal) {
          result.skipped.push({ bidder, reason: "seal expired/absent" });
          continue;
        }

        let opened;
        try {
          opened = await openBid(new Uint8Array(seal.ciphertext), drand);
        } catch (e) {
          result.skipped.push({ bidder, reason: `decrypt failed: ${errorName(e)}` });
          continue;
        }

        try {
          await sdk.reveal({
            roundId: rid,
            bidder,
            value: opened.value,
            nonce: opened.nonce,
          });
          result.revealed.push(bidder);
          log(`revealed ${bidder} = ${opened.value}`);
        } catch (e) {
          if (errorMatches(e, IDEMPOTENT_REVEAL)) {
            result.skipped.push({ bidder, reason: "already revealed (race)" });
          } else if (errorMatches(e, ["HashMismatch"])) {
            // A reveal that does not hash to H is rejected by the contract; the
            // canonical value is whatever we decrypted, so this only happens for a
            // corrupt seal — record and move on.
            result.skipped.push({ bidder, reason: "hash mismatch (corrupt seal)" });
          } else if (errorMatches(e, ["RevealWindowClosed"])) {
            result.skipped.push({ bidder, reason: "reveal window closed" });
          } else {
            throw e;
          }
        }
      }

      // Only advance the cursor when every bidder ended up revealed. A seal we
      // could not decrypt, or a window that closed mid-pass, must stay retryable.
      if (result.skipped.every((s) => REVEALED_REASONS.has(s.reason))) {
        recordStep(deps, rid, "reveal");
      } else {
        log(`reveals incomplete; cursor left before the reveal step`);
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag !== "Open") {
    log(`round ${rid} is ${round.status.tag}; nothing to reveal`);
  }

  result.finalStatus = round.status.tag;
  return result;
}

export interface CloseResult {
  roundId: bigint;
  cleared: boolean;
  settled: boolean;
  voided: boolean;
  winner?: string;
  finalStatus: string;
  skipped: string[];
  /** Set when the settlement guard refused to submit (typed contract rule). */
  guardSkip?: ContractSkipEvent;
}

/** Drive a revealed round to completion: clear (after the reveal deadline) then
 *  settle. Permissionless and idempotent — re-running on an already cleared or
 *  settled round skips rather than erroring. */
export async function closeRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<CloseResult> {
  const { sdk, log = () => {} } = deps;
  const { clock } = keeperTime(deps);
  const rid = BigInt(roundId);
  const result: CloseResult = {
    roundId: rid,
    cleared: false,
    settled: false,
    voided: false,
    winner: undefined,
    finalStatus: "",
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} (close)`);

  // ── Phase C: clear once the reveal window has closed ──────────────────
  if (round.status.tag === "Revealing") {
    if (stepAlreadyDone(deps, rid, "clear")) {
      // The cursor says a previous process cleared this round. Do not re-broadcast
      // clear: the winner is already fixed and the escrow is already committed.
      log(`clear skipped: checkpoint records the round as cleared`);
      result.skipped.push("clear already complete (checkpoint)");
    } else {
      const now = clock.nowSeconds();
      if (now <= Number(round.reveal_deadline)) {
        result.skipped.push(`reveal window open until ${round.reveal_deadline}`);
        result.finalStatus = round.status.tag;
        return result;
      }
      const recoveredClear = await recoverBeforeRetry(deps, rid, "clear", "clear");
      if (recoveredClear) {
        result.cleared = true;
        log(`clear transaction recovered as confirmed for round ${rid}`);
      } else {
        try {
          const winner = await sdk.clear(rid);
          result.cleared = true;
          result.winner = winner;
          if (winner === undefined) {
            result.voided = true;
            log(`cleared → no valid bids; round voided + refunded`);
          } else {
            log(`cleared → winner ${winner}`);
          }
          recordStep(deps, rid, "clear");
        } catch (e) {
          if (errorMatches(e, ["AlreadyCleared", "RevealStillOpen", "WrongStatus", "RoundVoided"])) {
            result.skipped.push(`clear skipped: ${errorName(e)}`);
            if (errorMatches(e, ["AlreadyCleared"])) {
              recordStep(deps, rid, "clear");
            }
          } else {
            throw e;
          }
        }
      }
    }
    round = await sdk.getRound(rid);
  }

  // ── Phase D: settle a cleared round (real SAC transfers) ──────────────
  if (round.status.tag === "Cleared") {
    if (stepAlreadyDone(deps, rid, "settle")) {
      // This is the whole point of the cursor: a restart after a confirmed
      // settle must not pay the escrow out a second time.
      log(`settle skipped: checkpoint records the round as settled`);
      result.skipped.push("settle already complete (checkpoint)");
    } else {
      const recoveredSettle = await recoverBeforeRetry(deps, rid, "settle", "settle");
      if (recoveredSettle) {
        result.settled = true;
        log(`settle transaction recovered as confirmed for round ${rid}`);
      } else {
        try {
          await sdk.settle(rid);
          result.settled = true;
          log(`settled round ${rid}`);
          recordStep(deps, rid, "settle");
        } catch (e) {
          if (errorMatches(e, ["AlreadySettled", "NotCleared", "WrongStatus"])) {
            result.skipped.push(`settle skipped: ${errorName(e)}`);
            // The contract telling us it is already settled is proof the step landed —
            // record it so the next restart does not broadcast it again.
            if (errorMatches(e, ["AlreadySettled"])) {
              recordStep(deps, rid, "settle");
            }
          } else {
            throw e;
          }
        }
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag === "Settled") {
    result.skipped.push("already settled");
  } else if (round.status.tag === "Voided") {
    result.skipped.push("voided (escrow refunded at clear)");
  }

  if (result.winner === undefined && round.winner != null) {
    result.winner = round.winner;
  }
  result.finalStatus = round.status.tag;
  return result;
}

export interface VoidResult {
  roundId: bigint;
  voided: boolean;
  skipped: string[];
  finalStatus: string;
  /** Set when the settlement guard refused to submit (typed contract rule). */
  guardSkip?: ContractSkipEvent;
}

/**
 * The status/grace half of the void rules, as a view with no bidder reads:
 * `evaluateVoid` only inspects status and the grace window until the bidder
 * page is consulted, so this decides "is a void even on the table?" without
 * paying for the full read when it is not.
 */
function voidGateView(round: {
  status: { tag: string };
  clearing_rule?: { tag: string };
  reveal_deadline: bigint | number;
  winner?: string | null;
  winning_bid?: bigint | null;
}, roundId: bigint, nowSeconds: number): RoundSettlementView {
  return {
    roundId: roundId.toString(),
    status: round.status.tag,
    clearingRule: round.clearing_rule?.tag === "LowestBid" ? "LowestBid" : "HighestBid",
    revealDeadline: Number(round.reveal_deadline),
    nowSeconds,
    bidders: [],
    bidderTotal: 0,
    winner: round.winner ?? null,
    winningBid: round.winning_bid == null ? null : BigInt(round.winning_bid),
  };
}

/** Liveness safety valve: void an Open round if R never arrived and grace elapsed. */
export async function voidIfStale(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<VoidResult> {
  const { sdk, log = () => {} } = deps;
  const { clock } = keeperTime(deps);
  const guard = deps.settlementGuard;
  const rid = BigInt(roundId);
  const result: VoidResult = {
    roundId: rid,
    voided: false,
    skipped: [],
    finalStatus: "",
  };

  const round = await sdk.getRound(rid);
  const now = clock.nowSeconds();

  // ── Cheap gate: only an Open round can ever be voided ──────────────────
  if (round.status.tag !== "Open") {
    result.finalStatus = round.status.tag;
    if (!guard) {
      result.skipped.push(`status ${round.status.tag}`);
      return result;
    }
    // A void of a round the contract would not accept (Revealing, Cleared,
    // Settled, Voided) is refused with the typed rule the status endpoint
    // shows — the keeper considered it and deliberately did not submit.
    const checked = guard.checkVoid(voidGateView(round, rid, now));
    const noteStatus = () => result.skipped.push(`status ${round.status.tag}`);
    if (checked.allowed) {
      noteStatus();
      return result;
    }
    const refusal = contractRefusal(checked.event);
    if (!refusal) {
      // Duplicate suppression already reported this round; nothing withheld.
      noteStatus();
      return result;
    }
    result.guardSkip = refusal;
    const reason = describeSettlementSkip(checked.event);
    result.skipped.push(`void refused: ${reason}`);
    log(`void refused for round ${rid}: ${reason}`);
    return result;
  }

  const gate = evaluateVoid(voidGateView(round, rid, now));
  if (!gate.allowed) {
    // Open, but the contract would still reject it — record the typed reason
    // the status endpoint shows instead of paying for a failed transaction.
    if (guard) {
      const refused = guard.checkVoid(voidGateView(round, rid, now));
      if (!refused.allowed) {
        result.guardSkip = contractRefusal(refused.event);
        const reason = describeSettlementSkip(refused.event);
        result.skipped.push(`void refused: ${reason}`);
        log(`void refused for round ${rid}: ${reason}`);
      }
    } else {
      result.skipped.push(
        `void not yet allowed until ${voidAfter(Number(round.reveal_deadline))}`,
      );
    }
    result.finalStatus = round.status.tag;
    return result;
  }

  const recoveredVoid = await recoverBeforeRetry(deps, rid, "void", "void");
  if (recoveredVoid) {
    result.voided = true;
    guard?.markTerminal(rid, "voided on-chain");
    log(`void transaction recovered as confirmed for round ${rid}`);
    const after = await sdk.getRound(rid);
    result.finalStatus = after.status.tag;
    return result;
  }

  // ── A void is on the table: verify the refund set before dispatching ───
  if (guard) {
    const view = await readSettlementView(sdk, rid, now);
    const check = guard.checkVoid(view);
    if (!check.allowed) {
      result.guardSkip = contractRefusal(check.event);
      const reason = describeSettlementSkip(check.event);
      result.skipped.push(`void refused: ${reason}`);
      log(`void refused for round ${rid}: ${reason}`);
      const after = await sdk.getRound(rid);
      result.finalStatus = after.status.tag;
      return result;
    }
    guard.markSubmitted(rid);
  }

  try {
    await sdk.void(rid);
    result.voided = true;
    guard?.markTerminal(rid, "voided on-chain");
    log(`voided round ${rid} (Drand liveness / grace elapsed)`);
    recordStep(deps, rid, "void");
  } catch (e) {
    if (errorMatches(e, ["NotVoidable", "WrongStatus", "AlreadyCleared"])) {
      result.skipped.push(errorName(e));
      guard?.markTerminal(rid, errorName(e));
    } else {
      guard?.markRetryable(rid, errorName(e));
      throw e;
    }
  }
  const after = await sdk.getRound(rid);
  result.finalStatus = after.status.tag;
  return result;
}

/** Parse `1,2,5` or `1-5` into round ids. */
export function parseRoundIdSpec(spec: string): bigint[] {
  const ids = new Set<bigint>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-", 2).map((s) => BigInt(s.trim()));
      for (let i = a; i <= b; i++) ids.add(i);
    } else {
      ids.add(BigInt(part));
    }
  }
  return [...ids].sort((x, y) => compareRoundIds(x, y));
}

export async function discoverRoundIds(
  reader: Pick<SubRosaClient, "getRound">,
  opts: { from?: bigint; maxProbe?: number } = {},
): Promise<bigint[]> {
  const from = opts.from ?? 1n;
  const maxProbe = opts.maxProbe ?? 64;
  const ids: bigint[] = [];
  for (let i = 0n; i < BigInt(maxProbe); i++) {
    const id = from + i;
    try {
      await reader.getRound(id);
      ids.push(id);
    } catch (e) {
      if (errorMatches(e, ["RoundNotFound"])) break;
      throw e;
    }
  }
  return ids;
}

export interface WatchTickResult {
  roundId: bigint;
  keep?: KeeperResult;
  close?: CloseResult;
  void?: VoidResult;
  finalStatus: string;
}

/** One non-blocking watch pass: void-if-stale → keep → close. */
export async function watchRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<WatchTickResult> {
  const rid = BigInt(roundId);
  const tick: WatchTickResult = { roundId: rid, finalStatus: "" };

  const voidRes = await voidIfStale(deps, rid);
  if (voidRes.voided || voidRes.guardSkip) tick.void = voidRes;

  let round = await deps.sdk.getRound(rid);
  if (round.status.tag === "Open" || round.status.tag === "Revealing") {
    tick.keep = await keepRound(
      { ...deps, maxWaitSeconds: 0 },
      rid,
    );
    round = await deps.sdk.getRound(rid);
  }

  if (
    round.status.tag === "Revealing" ||
    round.status.tag === "Cleared"
  ) {
    tick.close = await closeRound(deps, rid);
    round = await deps.sdk.getRound(rid);
  }

  tick.finalStatus = round.status.tag;
  return tick;
}
