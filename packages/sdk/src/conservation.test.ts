// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BidState, BiddersPage } from "@sub-rosa/round-bindings";

import {
  ESCROW_MAX_BIDDERS,
  evaluateEscrowConservation,
  isEscrowConserved,
  proveEscrowConservationFromPages,
  type EscrowConservationIssue,
  type EscrowConservationSource,
} from "./conservation.js";
import { SubRosaEscrowConservationError } from "./errors.js";

function bidState(escrow: bigint, settled = false): BidState {
  return {
    commitment: Buffer.alloc(32),
    escrow,
    revealed_nonce: undefined,
    revealed_value: undefined,
    settled,
    valid: false,
  };
}

interface FakeIndex {
  bidders: string[];
  escrow: Record<string, bigint>;
  pageSize?: number;
  settled?: Record<string, boolean>;
  totals?: (cursor: number) => number;
  nextCursor?: (cursor: number) => number;
  pages?: (data: string[]) => string[];
}

/** A page source over an in-memory bidder index, with hooks to corrupt it. */
function source(options: FakeIndex): EscrowConservationSource & { calls: number } {
  const pageSize = options.pageSize ?? 100;
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async getBiddersPage(cursor: number, limit: number): Promise<BiddersPage> {
      calls += 1;
      const size = Math.max(1, Math.min(limit, pageSize));
      const slice = options.bidders.slice(cursor, cursor + size);
      const data = options.pages ? options.pages(slice) : slice;
      return {
        data,
        next_cursor: options.nextCursor
          ? options.nextCursor(cursor)
          : cursor + size >= options.bidders.length
            ? 0
            : cursor + size,
        total: options.totals ? options.totals(cursor) : options.bidders.length,
      };
    },
    async getBidState(bidder: string): Promise<BidState | undefined> {
      const escrow = options.escrow[bidder];
      if (escrow === undefined) return undefined;
      return bidState(escrow, options.settled?.[bidder] ?? false);
    },
  };
}

function codes(issues: EscrowConservationIssue[]): string[] {
  return issues.map((i) => i.code);
}

describe("escrow conservation predicate", () => {
  it("should accept an open round where all escrow is refundable", () => {
    const report = evaluateEscrowConservation({
      bidders: 2,
      escrowHeld: 900n,
      refundable: 900n,
      payable: 0n,
    });
    assert.equal(report.conserved, true);
    assert.equal(report.stranded, 0n);
    assert.equal(report.surplus, 0n);
    assert.deepEqual(report.issues, []);
  });

  it("should accept a settlement paying the winner and refunding everyone else", () => {
    const report = evaluateEscrowConservation({
      bidders: 3,
      escrowHeld: 1_200n,
      refundable: 500n,
      payable: 700n,
      winnerEscrow: 700n,
    });
    assert.equal(report.conserved, true);
    assert.equal(report.surplus, 0n);
  });

  it("should accept a settlement that returns a winner surplus", () => {
    const report = evaluateEscrowConservation({
      bidders: 3,
      escrowHeld: 1_200n,
      refundable: 500n,
      payable: 500n,
      winnerEscrow: 700n,
    });
    assert.equal(report.conserved, true);
    assert.equal(report.surplus, 200n);
  });

  it("should reject escrow the pending operation would strand", () => {
    const stranded = evaluateEscrowConservation({
      bidders: 2,
      escrowHeld: 1_200n,
      refundable: 500n,
      payable: 500n,
      winnerEscrow: 500n,
    });
    assert.equal(stranded.conserved, false);
    assert.equal(stranded.stranded, 200n);
    assert.deepEqual(codes(stranded.issues), ["escrow_stranded"]);
  });

  it("should reject a payout not backed by the winner's escrow", () => {
    const report = evaluateEscrowConservation({
      bidders: 1,
      escrowHeld: 700n,
      refundable: 700n,
      payable: 700n,
      winnerEscrow: 0n,
    });
    assert.equal(report.conserved, false);
    assert.equal(report.surplus, -700n);
  });

  it("should reject negative amounts and outstanding issues", () => {
    assert.equal(
      isEscrowConserved({ escrowHeld: -1n, refundable: 0n, payable: 0n }),
      false,
    );
    assert.equal(
      isEscrowConserved({ escrowHeld: 0n, refundable: -1n, payable: 0n }),
      false,
    );
    assert.equal(
      isEscrowConserved({ escrowHeld: 100n, refundable: 100n, payable: 0n, winnerEscrow: -1n }),
      false,
    );
    const issues: EscrowConservationIssue[] = [
      { code: "duplicate_bidder", message: "dupe" },
    ];
    assert.equal(
      isEscrowConserved({ escrowHeld: 100n, refundable: 100n, payable: 0n, issues }),
      false,
    );
  });
});

describe("proveEscrowConservationFromPages", () => {
  it("should prove an empty round with no escrow", async () => {
    const report = await proveEscrowConservationFromPages(
      source({ bidders: [], escrow: {} }),
    );
    assert.equal(report.conserved, true);
    assert.equal(report.bidders, 0);
    assert.equal(report.escrowHeld, 0n);
  });

  it("should prove a single bidder", async () => {
    const report = await proveEscrowConservationFromPages(
      source({ bidders: ["a"], escrow: { a: 700n } }),
    );
    assert.equal(report.conserved, true);
    assert.equal(report.bidders, 1);
    assert.equal(report.escrowHeld, 700n);
    assert.equal(report.refundable, 700n);
  });

  it("should prove a multi-page index and the settlement it implies", async () => {
    const bidders = ["a", "b", "c", "d", "e"];
    const src = source({
      bidders,
      escrow: { a: 100n, b: 150n, c: 200n, d: 250n, e: 300n },
      pageSize: 2,
    });
    const report = await proveEscrowConservationFromPages(src, {
      pageSize: 2,
      payable: 200n,
      winner: "c",
    });
    assert.equal(report.bidders, 5);
    assert.equal(report.escrowHeld, 1_000n);
    assert.equal(report.refundable, 800n, "everyone except the winner");
    assert.equal(report.winnerEscrow, 200n);
    assert.equal(report.surplus, 0n);
    assert.equal(report.conserved, true);
    assert.ok(src.calls >= 3, "the walk paged instead of fetching everything at once");
  });

  it("should prove a void, where all escrow is refundable and nobody is paid", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b", "c", "d"],
        escrow: { a: 100n, b: 150n, c: 200n, d: 250n },
        pageSize: 2,
      }),
      { pageSize: 2 },
    );
    assert.equal(report.conserved, true);
    assert.equal(report.refundable, 700n);
    assert.equal(report.payable, 0n);
  });

  it("should refuse to pay out of an index that lost the winner", async () => {
    const report = await proveEscrowConservationFromPages(
      source({ bidders: ["a", "b", "c"], escrow: { a: 100n, b: 150n, c: 200n } }),
      { payable: 500n, winner: "missing" },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("winner_not_indexed"));
  });

  it("should report a total that drifts between pages", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b", "c", "d"],
        escrow: { a: 1n, b: 1n, c: 1n, d: 1n },
        pageSize: 2,
        totals: (cursor) => (cursor === 0 ? 4 : 3),
      }),
      { pageSize: 2 },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("page_total_drift"));
  });

  it("should report a page that repeats a bidder", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b", "c", "d"],
        escrow: { a: 1n, b: 1n, c: 1n, d: 1n },
        pageSize: 2,
        pages: (data) => (data.length > 1 ? ["a", "b"] : data),
      }),
      { pageSize: 2 },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("duplicate_bidder"));
  });

  it("should report a stalled cursor instead of looping forever", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b", "c"],
        escrow: { a: 1n, b: 1n, c: 1n },
        pageSize: 1,
        nextCursor: () => 1,
      }),
      { pageSize: 1, maxPages: 4 },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("cursor_stalled"));
  });

  it("should report a page count that disagrees with the declared total", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b", "c"],
        escrow: { a: 1n, b: 1n, c: 1n },
        pageSize: 3,
        totals: () => 9,
      }),
      { pageSize: 3 },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("page_count_mismatch"));
  });

  it("should report a paged index that disagrees with the round's bidder list", async () => {
    const report = await proveEscrowConservationFromPages(
      source({ bidders: ["a"], escrow: { a: 700n } }),
      { expectedBidders: ["a", "b"] },
    );
    assert.equal(report.conserved, false);
    const issue = report.issues.find((i) => i.code === "index_mismatch" && i.bidder);
    assert.equal(issue?.bidder, "b");
  });

  it("should report an indexed address with no bid state", async () => {    const report = await proveEscrowConservationFromPages(
      source({ bidders: ["a", "phantom"], escrow: { a: 500n } }),
    );
    assert.equal(report.conserved, false);
    const issue = report.issues.find((i) => i.code === "bid_state_missing");
    assert.ok(issue);
    assert.equal(issue?.bidder, "phantom");
    assert.equal(report.escrowHeld, 500n, "the unreadable escrow is not counted as held");
  });

  it("should report a bid already marked settled", async () => {
    const report = await proveEscrowConservationFromPages(
      source({
        bidders: ["a", "b"],
        escrow: { a: 100n, b: 150n },
        settled: { a: true },
      }),
    );
    assert.equal(report.conserved, false);
    const issue = report.issues.find((i) => i.code === "bidder_already_settled");
    assert.equal(issue?.bidder, "a");
    assert.equal(report.stranded, 100n, "settled escrow is no longer refundable");
  });

  it("should reject a page size the contract would not accept", async () => {
    const report = await proveEscrowConservationFromPages(
      source({ bidders: [], escrow: {} }),
      { pageSize: 0 },
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("cursor_stalled"));
  });

  it("should cap the walk at the contract bidder maximum", async () => {
    const bidders = Array.from({ length: ESCROW_MAX_BIDDERS + 1 }, (_, i) => `b${i}`);
    const escrow = Object.fromEntries(bidders.map((b) => [b, 1n]));
    const report = await proveEscrowConservationFromPages(
      source({ bidders, escrow, pageSize: 100 }),
    );
    assert.equal(report.conserved, false);
    assert.ok(codes(report.issues).includes("page_count_mismatch"));
  });
});

describe("SubRosaEscrowConservationError", () => {
  it("should carry the round, phase, and report for keeper handling", () => {
    const report = evaluateEscrowConservation({
      bidders: 2,
      escrowHeld: 900n,
      refundable: 500n,
      payable: 400n,
      winnerEscrow: 500n,
      issues: [{ code: "bidder_already_settled", message: "settled early" }],
    });
    const err = new SubRosaEscrowConservationError({
      roundId: 7n,
      phase: "settle",
      report,
    });
    assert.ok(err instanceof SubRosaEscrowConservationError);
    assert.equal(err.name, "SubRosaPreflightError");
    assert.equal(err.kind, "escrow_not_conserved");
    assert.equal(err.operation, "settle");
    assert.equal(err.roundId, 7n);
    assert.equal(err.phase, "settle");
    assert.equal(err.report, report);
    assert.match(err.message, /round 7 does not conserve escrow before settle/);
    assert.match(err.message, /settled early/);
  });
});
