// SPDX-License-Identifier: MIT
// Escrow conservation — the off-chain mirror of the Round contract's
// `EscrowNotConserved` guard (issue #374).
//
// On-chain the invariant is a running identity over a per-round ledger:
//
//     committed == payout + refunds + locked
//
// where `locked` is the sum of `escrow` over every *unsettled* bid in the
// round's bidder index. A keeper cannot see that ledger, so this module
// re-derives the same accounting purely from the public views: it walks the
// bidder index in pages, reads every bid state, and checks that the escrow the
// index attributes to the round is exactly the escrow a pending `clear`,
// `settle`, or `void` will move.
//
// A settlement moves `refundable` back to the losing bidders, `payable` to the
// operator, and the winner's `surplus` back to the winner — together exactly
// the escrow the index holds. A dropped, duplicated, or already-settled bidder
// breaks that identity, which is precisely the class of bug the contract now
// refuses to pay out of. Every way it can break gets its own issue code so a
// keeper can react programmatically instead of parsing text.

import type { BidState, BiddersPage } from "@sub-rosa/round-bindings";

/** Default page size; the contract caps `limit` at 100. */
export const ESCROW_PAGE_SIZE = 100;

/** The Round contract refuses more than 500 committed bidders. */
export const ESCROW_MAX_BIDDERS = 500;

/** The operations that move escrow out of a round and need a conserved proof. */
export type EscrowConservationPhase = "clear" | "settle" | "void";

export type EscrowConservationIssueCode =
  /** `total` disagreed between two pages of the same round. */
  | "page_total_drift"
  /** The same address appeared twice in the walk. */
  | "duplicate_bidder"
  /** The pages returned a different number of addresses than `total` claims. */
  | "page_count_mismatch"
  /** `next_cursor` failed to advance, pointed backwards, or outran `total`. */
  | "cursor_stalled"
  /** An indexed address has no bid state. */
  | "bid_state_missing"
  /** A bid is already settled while the round still has escrow locked. */
  | "bidder_already_settled"
  /** A bid reported a negative escrow. */
  | "escrow_locked"
  /** The paged index disagrees with the bidder list on the round record. */
  | "index_mismatch"
  /** The cleared winner has no entry in the bidder index. */
  | "winner_not_indexed"
  /** The round is not in a status where the requested operation can run. */
  | "round_wrong_status"
  /** A `settle` was requested for a round with no winner or winning bid. */
  | "no_winner"
  /** Escrow the pending operation cannot account for would be left locked. */
  | "escrow_stranded";

export interface EscrowConservationIssue {
  code: EscrowConservationIssueCode;
  message: string;
  /** Bidder the issue is about, when it is about a single bid. */
  bidder?: string;
}

export interface EscrowConservationTotals {
  /** Escrow attributed to the round by the bidder walk. */
  escrowHeld: bigint;
  /** Escrow the pending operation refunds to losing bidders. */
  refundable: bigint;
  /** Escrow the pending operation pays to the operator. */
  payable: bigint;
  /** Escrow the winner's own bid holds. Zero when nobody won the round. */
  winnerEscrow?: bigint;
  issues?: EscrowConservationIssue[];
}

export interface EscrowConservationReport extends EscrowConservationTotals {
  /** Every distinct indexed address observed in the walk. */
  bidders: number;
  /** Escrow returned to the winner above their own bid. */
  surplus: bigint;
  /** Escrow the pending operation cannot account for. Must be zero. */
  stranded: bigint;
  /** True only when there are no issues and nothing is stranded. */
  conserved: boolean;
  issues: EscrowConservationIssue[];
}

/** The conservation predicate: the round can account for every dollar it holds. */
export function isEscrowConserved(totals: EscrowConservationTotals): boolean {
  if ((totals.issues ?? []).length > 0) return false;
  if (totals.escrowHeld < 0n) return false;
  if (totals.refundable < 0n) return false;
  if (totals.payable < 0n) return false;
  const winnerEscrow = totals.winnerEscrow ?? 0n;
  if (winnerEscrow < 0n) return false;
  // The operator is paid out of the winner's escrow, never on top of it.
  if (winnerEscrow < totals.payable) return false;
  const surplus = winnerEscrow - totals.payable;
  return totals.escrowHeld === totals.refundable + totals.payable + surplus;
}

/** Apply the predicate to a set of totals, returning the full report. */
export function evaluateEscrowConservation(
  totals: EscrowConservationTotals & { bidders?: number },
): EscrowConservationReport {
  const issues = [...(totals.issues ?? [])];
  const winnerEscrow = totals.winnerEscrow ?? 0n;
  const surplus = winnerEscrow - totals.payable;
  const moved = totals.refundable + totals.payable + surplus;
  const stranded = totals.escrowHeld - moved;
  if (stranded > 0n) {
    issues.push({
      code: "escrow_stranded",
      message:
        `${stranded} unit(s) of escrow would stay locked: the index holds ` +
        `${totals.escrowHeld} but the operation moves only ${moved}`,
    });
  }
  return {
    bidders: totals.bidders ?? 0,
    escrowHeld: totals.escrowHeld,
    refundable: totals.refundable,
    payable: totals.payable,
    winnerEscrow,
    surplus,
    stranded,
    conserved: isEscrowConserved(totals),
    issues,
  };
}

/** The subset of client reads a conservation walk needs. */
export interface EscrowConservationSource {
  getBiddersPage(cursor: number, limit: number): Promise<BiddersPage>;
  getBidState(bidder: string): Promise<BidState | undefined>;
}

export interface ProveEscrowConservationOptions {
  /** Page size for the index walk. Default: 100, the contract maximum. */
  pageSize?: number;
  /** Escrow the pending operation pays to the operator. Default: 0. */
  payable?: bigint;
  /** The cleared winner, whose surplus is part of the settlement. */
  winner?: string;
  /**
   * The bidder list carried by the round record. The contract pays out of that
   * list, so a paged walk that disagrees with it cannot be trusted.
   */
  expectedBidders?: string[];
  /** Issues already known about the round (status, winner, prior reads). */
  issues?: EscrowConservationIssue[];
  /** Safety valve for a hostile or buggy page source. Default: 6 pages. */
  maxPages?: number;
}

function issue(
  code: EscrowConservationIssueCode,
  message: string,
  bidder?: string,
): EscrowConservationIssue {
  return bidder === undefined ? { code, message } : { code, message, bidder };
}

/**
 * Walk the bidder index in pages and re-derive the round's escrow accounting.
 *
 * The walk is deliberately strict: a total that drifts between pages, a cursor
 * that repeats or stalls, a duplicated address, a missing bid state, a bid
 * already marked settled, or a missing winner all make the round unprovable.
 * That mirrors the contract, which refuses to pay out of a bidder index it
 * cannot reconcile.
 */
export async function proveEscrowConservationFromPages(
  source: EscrowConservationSource,
  options: ProveEscrowConservationOptions = {},
): Promise<EscrowConservationReport> {
  const pageSize = options.pageSize ?? ESCROW_PAGE_SIZE;
  const maxPages = options.maxPages ?? Math.ceil(ESCROW_MAX_BIDDERS / pageSize) + 1;
  const issues: EscrowConservationIssue[] = [...(options.issues ?? [])];
  const payable = options.payable ?? 0n;
  const winner = options.winner;

  const empty = () =>
    evaluateEscrowConservation({
      bidders: 0,
      escrowHeld: 0n,
      refundable: 0n,
      payable,
      winnerEscrow: 0n,
      issues,
    });

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    issues.push(
      issue(
        "cursor_stalled",
        `pageSize must be an integer between 1 and 100, got ${pageSize}`,
      ),
    );
    return empty();
  }

  const seen = new Set<string>();
  let escrowHeld = 0n;
  let refundable = 0n;
  let winnerEscrow = 0n;
  let declaredTotal: number | undefined;
  let cursor = 0;
  let pages = 0;

  for (;;) {
    const page = await source.getBiddersPage(cursor, pageSize);
    pages += 1;

    if (declaredTotal === undefined) declaredTotal = page.total;
    else if (page.total !== declaredTotal) {
      issues.push(
        issue(
          "page_total_drift",
          `bidder count changed mid-walk: page at cursor ${cursor} reports ` +
            `${page.total} bidders, earlier pages reported ${declaredTotal}`,
        ),
      );
    }

    for (const bidder of page.data) {
      if (seen.has(bidder)) {
        issues.push(
          issue(
            "duplicate_bidder",
            `bidder ${bidder} appears more than once in the index; paying it ` +
              `twice would mint from escrow that was already refunded`,
            bidder,
          ),
        );
        continue;
      }
      seen.add(bidder);

      const state = await source.getBidState(bidder);
      if (!state) {
        issues.push(
          issue(
            "bid_state_missing",
            `indexed bidder ${bidder} has no bid state, so their escrow cannot ` +
              `be accounted for`,
            bidder,
          ),
        );
        continue;
      }
      if (state.escrow < 0n) {
        issues.push(
          issue(
            "escrow_locked",
            `bidder ${bidder} reports a negative escrow (${state.escrow})`,
            bidder,
          ),
        );
        continue;
      }
      escrowHeld += state.escrow;
      if (state.settled) {
        issues.push(
          issue(
            "bidder_already_settled",
            `bidder ${bidder} is already settled while ${state.escrow} of their ` +
              `escrow is still locked`,
            bidder,
          ),
        );
        continue;
      }
      if (bidder === winner) winnerEscrow += state.escrow;
      else refundable += state.escrow;
    }

    if (seen.size > ESCROW_MAX_BIDDERS) {
      issues.push(
        issue(
          "page_count_mismatch",
          `index returned more than the contract maximum of ${ESCROW_MAX_BIDDERS} bidders`,
        ),
      );
      break;
    }
    if (page.next_cursor === 0) break;
    if (page.next_cursor <= cursor) {
      issues.push(
        issue(
          "cursor_stalled",
          `next_cursor ${page.next_cursor} did not advance past ${cursor}`,
        ),
      );
      break;
    }
    if (pages >= maxPages) {
      issues.push(
        issue(
          "cursor_stalled",
          `index walk exceeded ${maxPages} pages before the cursor reached 0`,
        ),
      );
      break;
    }
    if (page.next_cursor > ESCROW_MAX_BIDDERS) {
      issues.push(
        issue(
          "cursor_stalled",
          `next_cursor ${page.next_cursor} points past the contract maximum of ` +
            `${ESCROW_MAX_BIDDERS} bidders`,
        ),
      );
      break;
    }
    cursor = page.next_cursor;
  }

  if (winner !== undefined && !seen.has(winner)) {
    issues.push(
      issue(
        "winner_not_indexed",
        `winner ${winner} is not in the bidder index, so the ${payable} payout ` +
          `is not backed by escrowed collateral`,
        winner,
      ),
    );
  }

  const expected = options.expectedBidders;
  if (expected) {
    const expectedSet = new Set(expected);
    if (expectedSet.size !== seen.size) {
      issues.push(
        issue(
          "index_mismatch",
          `the round lists ${expected.length} bidders but the paged index ` +
            `returned ${seen.size}`,
        ),
      );
    }
    for (const bidder of expectedSet) {
      if (!seen.has(bidder)) {
        issues.push(
          issue(
            "index_mismatch",
            `bidder ${bidder} is on the round record but missing from the paged ` +
              `index the contract pays out of`,
            bidder,
          ),
        );
      }
    }
  }

  if (declaredTotal !== undefined && seen.size !== declaredTotal) {
    issues.push(
      issue(
        "page_count_mismatch",
        `index claims ${declaredTotal} bidders but the walk observed ${seen.size}`,
      ),
    );
  }

  return evaluateEscrowConservation({
    bidders: seen.size,
    escrowHeld,
    refundable,
    payable,
    winnerEscrow,
    issues,
  });
}
