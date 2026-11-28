// Copyright (c) 2026 Sub Rosa contributors
// settlement-guard.test.ts
//
// Tests for Issue #79 — keeper duplicate-settlement suppression.
//
// All tests are fully offline: no RPC, no real transactions, no Drand.
// The keeper is exercised through the SettlementGuard helper directly, and
// through a thin mock of the closeRound / settle code-path that mirrors
// keeper.ts's actual state-machine logic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { SubRosaClient } from "@sub-rosa/sdk";
import type { DrandClient } from "@sub-rosa/tlock";
import { FakeClock } from "@sub-rosa/time";

import { closeRound, voidIfStale } from "./keeper.js";
import {
  createSettlementGuard,
  describeSettlementSkip,
  evaluateSettle,
  evaluateVoid,
  expectedWinner,
  readSettlementView,
  VOID_GRACE_SECONDS,
} from "./settlement-guard.js";
import type {
  DuplicateSkipEvent,
  GuardBidderState,
  RoundSettlementView,
  SettlementGuard,
} from "./settlement-guard.js";

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

/** Build a fake on-chain round object at a given status tag. */
function mockRound(tag: string) {
  return {
    status: { tag },
    reveal_round: 1n,
    reveal_deadline: BigInt(1_700_000_000 - 3600),
    winner: tag === "Cleared" ? "GABC" : undefined,
  };
}

/**
 * A tiny simulation of the settle phase in keeper.ts's closeRound, wired
 * through a SettlementGuard.  Returns a structured description of what
 * happened so tests can assert without parsing log strings.
 */
async function simulateSettle(
  guard: SettlementGuard,
  roundId: bigint,
  opts: {
    onChainStatus: string;
    /** If provided, sdk.settle() throws this error. */
    settleThrows?: Error;
    log?: (msg: string) => void;
  },
): Promise<{
  settled: boolean;
  skipped: boolean;
  skipEvent?: DuplicateSkipEvent;
  retriedAsRetryable: boolean;
  finalGuardStatus: string;
}> {
  const log = opts.log ?? (() => {});
  const result = {
    settled: false,
    skipped: false,
    skipEvent: undefined as DuplicateSkipEvent | undefined,
    retriedAsRetryable: false,
    finalGuardStatus: "",
  };

  // Mirror the guard check that a real keeper would do before sdk.settle().
  const check = guard.canSettle(roundId);
  if (!check.allowed) {
    result.skipped = true;
    result.skipEvent = check.event;
    log(
      `[settlement_skipped_duplicate] round=${roundId} reason=${check.event.skippedDuplicateReason} lastReason=${check.event.lastReason}`,
    );
    result.finalGuardStatus = guard.getEntry(roundId)!.status;
    return result;
  }

  // On-chain terminal statuses: guard them without dispatching a tx.
  if (opts.onChainStatus === "Settled" || opts.onChainStatus === "Voided") {
    guard.markTerminal(roundId, `on-chain status is ${opts.onChainStatus}`);
    result.finalGuardStatus = guard.getEntry(roundId)!.status;
    return result;
  }

  // Attempt settlement.
  guard.markSubmitted(roundId);
  try {
    if (opts.settleThrows) throw opts.settleThrows;
    // Mock successful settle — no real tx.
    result.settled = true;
    guard.markTerminal(roundId, "settled ok");
    log(`settled round ${roundId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Classify: AlreadySettled is terminal; other errors are retryable.
    if (msg.includes("AlreadySettled") || msg.includes("WrongStatus")) {
      guard.markTerminal(roundId, `skipped: ${msg}`);
      result.skipped = true;
    } else {
      guard.markRetryable(roundId, msg);
      result.retriedAsRetryable = true;
    }
  }

  result.finalGuardStatus = guard.getEntry(roundId)!.status;
  return result;
}

// ---------------------------------------------------------------------------
// 1. Guard state-machine unit tests
// ---------------------------------------------------------------------------

describe("SettlementGuard state machine", () => {
  it("allows the first settlement attempt (pending → submitted → terminal)", () => {
    const guard = createSettlementGuard();
    const id = 1n;

    // Before any call, canSettle allows.
    const first = guard.canSettle(id);
    assert.equal(first.allowed, true);

    // After markSubmitted, canSettle blocks.
    guard.markSubmitted(id);
    const second = guard.canSettle(id);
    assert.equal(second.allowed, false);
    if (!second.allowed) {
      assert.equal(second.event.skippedDuplicateReason, "submitted");
      assert.equal(second.event.event, "settlement_skipped_duplicate");
      assert.equal(second.event.roundId, "1");
    }

    // After markTerminal, canSettle still blocks with "terminal".
    guard.markTerminal(id, "settled ok");
    const third = guard.canSettle(id);
    assert.equal(third.allowed, false);
    if (!third.allowed) {
      assert.equal(third.event.skippedDuplicateReason, "terminal");
    }
  });

  it("skips a round already in submitted status (duplicate observation)", () => {
    const guard = createSettlementGuard();
    const id = 42n;

    guard.markSubmitted(id);

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.equal(check.event.skippedDuplicateReason, "submitted");
      assert.equal(check.event.roundId, "42");
      // Structured event must carry the field name the issue requires.
      assert.ok(
        "skippedDuplicateReason" in check.event,
        "event must include skippedDuplicateReason",
      );
    }
  });

  it("skips a terminal round without attempting another settle", () => {
    const guard = createSettlementGuard();
    const id = 7n;

    guard.markTerminal(id, "settled via concurrent keeper");

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.equal(check.event.skippedDuplicateReason, "terminal");
      assert.equal(check.event.lastReason, "settled via concurrent keeper");
    }
  });

  it("makes a failed attempt retryable — does not permanently suppress it", () => {
    const guard = createSettlementGuard();
    const id = 99n;

    // Simulate: submitted, then a network timeout.
    guard.markSubmitted(id);
    guard.markRetryable(id, "rpc timeout");

    // Must be allowed again on the next polling cycle.
    const check = guard.canSettle(id);
    assert.equal(check.allowed, true, "retryable round must be re-allowed");
    assert.equal(guard.getEntry(id)!.status, "pending");
    assert.match(guard.getEntry(id)!.reason, /retryable/);
  });

  it("does not bleed state between independent rounds", () => {
    const guard = createSettlementGuard();

    guard.markSubmitted(10n);
    guard.markTerminal(10n, "settled ok");

    // Round 11 and 12 must remain independently settable.
    assert.equal(guard.canSettle(11n).allowed, true);
    assert.equal(guard.canSettle(12n).allowed, true);

    // Round 10 must still be terminal.
    assert.equal(guard.canSettle(10n).allowed, false);
  });

  it("getEntry returns undefined for an untracked round", () => {
    const guard = createSettlementGuard();
    assert.equal(guard.getEntry(999n), undefined);
  });

  it("entries() reflects all tracked rounds in insertion order", () => {
    const guard = createSettlementGuard();
    guard.canSettle(3n); // triggers getOrCreate
    guard.canSettle(1n);
    guard.canSettle(2n);

    const ids = guard.entries().map((e) => e.roundId);
    assert.deepEqual(ids, [3n, 1n, 2n]);
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate-settlement simulation tests (mirrors keeper.ts's settle phase)
// ---------------------------------------------------------------------------

describe("Keeper duplicate-settlement suppression (simulated)", () => {
  it("does not attempt a duplicate settle when the same round is observed twice", async () => {
    const guard = createSettlementGuard();
    const id = 5n;

    // First observation — round is Cleared, settle succeeds.
    const first = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(first.settled, true);
    assert.equal(first.skipped, false);

    // Second observation — same round, same polling cycle.
    const second = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(second.settled, false);
    assert.equal(second.skipped, true);
    assert.ok(second.skipEvent, "must emit a skip event");
    assert.equal(second.skipEvent!.skippedDuplicateReason, "terminal");
    assert.equal(second.finalGuardStatus, "terminal");
  });

  it("skips settlement when the round is already terminal on-chain (Settled)", async () => {
    const guard = createSettlementGuard();
    const id = 8n;

    const res = await simulateSettle(guard, id, { onChainStatus: "Settled" });
    // No tx dispatched (settled = false); guard moves to terminal.
    assert.equal(res.settled, false);
    assert.equal(res.finalGuardStatus, "terminal");
  });

  it("skips settlement when the round is already terminal on-chain (Voided)", async () => {
    const guard = createSettlementGuard();
    const id = 9n;

    const res = await simulateSettle(guard, id, { onChainStatus: "Voided" });
    assert.equal(res.settled, false);
    assert.equal(res.finalGuardStatus, "terminal");
  });

  it("contract AlreadySettled error marks the round terminal, not retryable", async () => {
    const guard = createSettlementGuard();
    const id = 15n;

    const res = await simulateSettle(guard, id, {
      onChainStatus: "Cleared",
      settleThrows: new Error("AlreadySettled"),
    });
    assert.equal(res.skipped, true);
    assert.equal(res.retriedAsRetryable, false);
    assert.equal(res.finalGuardStatus, "terminal");

    // And a subsequent observation must also be skipped.
    const again = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(again.skipped, true);
    assert.ok(again.skipEvent);
    assert.equal(again.skipEvent!.skippedDuplicateReason, "terminal");
  });

  it("retryable network error resets to pending so next cycle can retry", async () => {
    const guard = createSettlementGuard();
    const id = 20n;

    const first = await simulateSettle(guard, id, {
      onChainStatus: "Cleared",
      settleThrows: new Error("rpc connection timeout"),
    });
    assert.equal(first.retriedAsRetryable, true);
    assert.equal(first.finalGuardStatus, "pending");

    // Next cycle: allowed to retry.
    const retry = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(retry.settled, true);
    assert.equal(retry.finalGuardStatus, "terminal");
  });

  it("independent rounds are never affected by each other's state", async () => {
    const guard = createSettlementGuard();

    // Settle round 30 and mark it terminal.
    await simulateSettle(guard, 30n, { onChainStatus: "Cleared" });
    assert.equal(guard.getEntry(30n)!.status, "terminal");

    // Rounds 31 and 32 must still be allowed.
    const r31 = await simulateSettle(guard, 31n, { onChainStatus: "Cleared" });
    const r32 = await simulateSettle(guard, 32n, { onChainStatus: "Cleared" });

    assert.equal(r31.settled, true);
    assert.equal(r32.settled, true);

    // Round 30 is still blocked.
    const r30again = await simulateSettle(guard, 30n, {
      onChainStatus: "Cleared",
    });
    assert.equal(r30again.skipped, true);
  });

  it("skip event includes skippedDuplicateReason and roundId as a string", async () => {
    const guard = createSettlementGuard();
    const id = 77n;

    guard.markTerminal(id, "pre-settled externally");

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      const ev = check.event;
      assert.equal(typeof ev.roundId, "string", "roundId must be a string");
      assert.ok(
        "skippedDuplicateReason" in ev,
        "event must have skippedDuplicateReason field",
      );
      assert.equal(ev.event, "settlement_skipped_duplicate");
      assert.equal(ev.skippedDuplicateReason, "terminal");
      assert.equal(ev.lastReason, "pre-settled externally");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Bounded-retry regression guard
// ---------------------------------------------------------------------------

describe("Bounded retry invariant", () => {
  it("a round that always fails stays retryable — never permanently suppressed", async () => {
    const guard = createSettlementGuard();
    const id = 50n;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await simulateSettle(guard, id, {
        onChainStatus: "Cleared",
        settleThrows: new Error("transient rpc error"),
      });
      assert.equal(
        res.retriedAsRetryable,
        true,
        `attempt ${attempt + 1} must remain retryable`,
      );
      assert.equal(
        guard.getEntry(id)!.status,
        "pending",
        `guard must be pending after attempt ${attempt + 1}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Shared settlement fixture — contracts/round/fixtures/settlement-cases.txt
//
// The same file drives contracts/round/src/test.rs. Every row asserts the
// guard's verdict against the verdict the round contract answers with, so the
// two suites can never drift apart: edit one side only and the other fails.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../contracts/round/fixtures/settlement-cases.txt",
    import.meta.url,
  ),
);

const REVEAL_DEADLINE = 1_700_000_000;

/**
 * Guard refusal → the contract error the very same view must fail with.
 * `null` marks a refusal that only exists because the keeper's local view is
 * incomplete: the contract may well accept the transaction, the guard still
 * refuses because it cannot promise a refund set it never read.
 *
 * Mirrored by `GUARD_REASON_CONTRACT_ERROR` / `LOCAL_VIEW_GUARD_REASONS` in
 * contracts/round/src/test.rs.
 */
const GUARD_REASON_TO_CONTRACT_ERROR: Record<string, string | null> = {
  already_settled: "AlreadySettled",
  round_voided: "RoundVoided",
  not_cleared: "NotCleared",
  missing_winner: "NoValidBids",
  void_not_open: "NotVoidable",
  void_grace_not_elapsed: "NotVoidable",
  refund_missing: null,
  bidder_page_incomplete: null,
  winner_mismatch: null,
};

interface FixtureRow {
  name: string;
  action: "settle" | "void";
  rule: "HighestBid" | "LowestBid";
  status: string;
  grace: boolean;
  bids: bigint[];
  /** Escrow the keeper could read; null when the bid state read failed. */
  keeperEscrows: (bigint | null)[];
  /** Escrow the contract actually holds (`?(N)` rows keep N here). */
  onChainEscrows: bigint[];
  revealed: boolean[];
  read: number;
  winnerIdx: number;
  operator: bigint;
  surplus: bigint;
  refunds: Array<{ idx: number; amount: bigint }>;
  guardReason: string;
  contract: string;
}

function parseFixtureRows(): FixtureRow[] {
  const text = fs.readFileSync(FIXTURE_PATH, "utf8");
  const rows: FixtureRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("name|")) continue;
    const f = line.split("|");
    assert.equal(f.length, 15, `fixture row "${line}" must have 15 fields`);
    const [name, action, rule, status, grace, bidsS, escrowsS, revealedS, readS, winnerS, operatorS, surplusS, refundsS, guardReason, contract] = f;

    const keeperEscrows: (bigint | null)[] = [];
    const onChainEscrows: bigint[] = [];
    for (const token of escrowsS.split(",")) {
      if (token.startsWith("?(") && token.endsWith(")")) {
        keeperEscrows.push(null);
        onChainEscrows.push(BigInt(token.slice(2, -1)));
      } else {
        keeperEscrows.push(BigInt(token));
        onChainEscrows.push(BigInt(token));
      }
    }

    const bids = bidsS.split(",").map((bid) => BigInt(bid));
    const revealed = revealedS.split(",").map((flag) => flag === "1");
    assert.equal(bids.length, keeperEscrows.length, `${name}: bids and escrows must align`);
    assert.equal(bids.length, revealed.length, `${name}: bids and revealed flags must align`);

    const refunds =
      refundsS === "-"
        ? []
        : refundsS.split(",").map((pair) => {
            const [idx, amount] = pair.split(":");
            return { idx: Number(idx), amount: BigInt(amount) };
          });

    rows.push({
      name,
      action: action as "settle" | "void",
      rule: rule as "HighestBid" | "LowestBid",
      status,
      grace: grace === "1",
      bids,
      keeperEscrows,
      onChainEscrows,
      revealed,
      read: Number(readS),
      winnerIdx: Number(winnerS),
      operator: BigInt(operatorS),
      surplus: BigInt(surplusS),
      refunds,
      guardReason,
      contract,
    });
  }
  assert.ok(
    rows.length >= 10,
    `the shared settlement fixture must keep every row (read ${rows.length})`,
  );
  return rows;
}

const FIXTURE_ROWS = parseFixtureRows();

/** The local view the guard sees for a fixture row, truncations and all. */
function fixtureView(row: FixtureRow): RoundSettlementView {
  const nowSeconds = row.grace
    ? REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1
    : REVEAL_DEADLINE + 100;
  const bidders: GuardBidderState[] = row.bids.slice(0, row.read).map((bid, i) => ({
    bidder: `B${i}`,
    escrow: row.keeperEscrows[i] ?? null,
    // An unreadable bid state hides the reveal as well: readSettlementView
    // records nothing it could not read instead of guessing a value.
    revealedValue:
      row.keeperEscrows[i] === null ? null : row.revealed[i] ? bid : null,
    settled: false,
  }));
  return {
    roundId: "1",
    status: row.status,
    clearingRule: row.rule,
    revealDeadline: REVEAL_DEADLINE,
    nowSeconds,
    bidders,
    bidderTotal: row.bids.length,
    winner: row.winnerIdx >= 0 ? `B${row.winnerIdx}` : null,
    winningBid: row.winnerIdx >= 0 ? row.bids[row.winnerIdx] : null,
  };
}

function refundLabels(
  refunds: Array<{ bidder: string; amount: bigint }>,
  row: FixtureRow,
): string[] {
  return refunds.map((refund) => {
    const idx = row.bids.findIndex((_bid, i) => `B${i}` === refund.bidder);
    return `${idx}:${refund.amount}`;
  });
}

describe("Shared settlement fixture (contract ⇄ guard)", () => {
  it("loads every row of the fixture the contract suite reads", () => {
    const names = FIXTURE_ROWS.map((row) => row.name);
    assert.equal(names.length, new Set(names).size, "fixture names must be unique");
  });

  for (const row of FIXTURE_ROWS) {
    it(`${row.name}: guard verdict matches the contract`, () => {
      const view = fixtureView(row);
      const decision =
        row.action === "settle" ? evaluateSettle(view) : evaluateVoid(view);

      if (row.guardReason === "-") {
        assert.equal(
          decision.allowed,
          true,
          `${row.name}: the guard must submit a round the contract accepts`,
        );
        const plan = decision.plan;
        assert.equal(plan.action, row.action, `${row.name}: action`);
        assert.equal(plan.operatorPayout, row.operator, `${row.name}: operator payout`);
        assert.equal(plan.winnerSurplus, row.surplus, `${row.name}: winner surplus`);
        if (row.action === "settle") {
          assert.equal(plan.winner, `B${row.winnerIdx}`, `${row.name}: winner`);
        } else {
          assert.equal(plan.winner, null, `${row.name}: a void has no winner`);
        }
        assert.deepEqual(
          refundLabels(plan.refunds, row),
          row.refunds.map((refund) => `${refund.idx}:${refund.amount}`),
          `${row.name}: refund set`,
        );
      } else {
        assert.equal(
          decision.allowed,
          false,
          `${row.name}: the guard must refuse what the contract would reject`,
        );
        assert.equal(decision.event.reason, row.guardReason, `${row.name}: reason`);
        assert.equal(decision.event.action, row.action, `${row.name}: refused action`);
        assert.equal(decision.event.event, "settlement_skipped_contract");
        assert.equal(decision.event.roundId, "1");
        assert.ok(describeSettlementSkip(decision.event).includes(row.guardReason));
      }
    });
  }

  it("every row the contract rejects is refused with the matching reason", () => {
    for (const row of FIXTURE_ROWS) {
      if (row.contract === "ok") continue;
      assert.notEqual(
        row.guardReason,
        "-",
        `${row.name}: the contract rejects with ${row.contract} — the guard must refuse too`,
      );
      const mapped = GUARD_REASON_TO_CONTRACT_ERROR[row.guardReason];
      assert.ok(mapped, `${row.name}: ${row.guardReason} is not a known guard reason`);
      assert.equal(
        mapped,
        row.contract,
        `${row.name}: guard reason ${row.guardReason} must be exactly why the contract rejects`,
      );
    }
  });

  it("every row the guard submits is a row the contract accepts", () => {
    for (const row of FIXTURE_ROWS) {
      if (row.guardReason !== "-") continue;
      assert.equal(
        row.contract,
        "ok",
        `${row.name}: the guard must never submit what the contract reverts`,
      );
    }
  });

  it("a local-view refusal never claims the contract rejects on its own", () => {
    for (const row of FIXTURE_ROWS) {
      const mapped = GUARD_REASON_TO_CONTRACT_ERROR[row.guardReason];
      if (row.guardReason === "-" || mapped !== null) continue;
      assert.equal(
        row.contract,
        "ok",
        `${row.name}: ${row.guardReason} is the keeper's view, not a contract rule`,
      );
    }
  });

  it("every guard reason in the fixture is one both suites know", () => {
    for (const row of FIXTURE_ROWS) {
      if (row.guardReason === "-") continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(GUARD_REASON_TO_CONTRACT_ERROR, row.guardReason),
        `${row.name}: unknown guard reason ${row.guardReason}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Acceptance: the guard refuses before anything reaches the chain
// ---------------------------------------------------------------------------

interface FakeRound {
  status: string;
  rule?: "HighestBid" | "LowestBid";
  revealDeadline: bigint;
  bidders: string[];
  states: Record<string, { escrow: bigint; revealed: bigint | null }>;
  winner?: string | null;
  winningBid?: bigint | null;
  /** Bidder addresses whose bid state read throws. */
  unreadable?: string[];
  /** Bidder addresses dropped from the index page (a truncated read). */
  dropped?: string[];
}

function createFakeSdk(round: FakeRound) {
  const calls = { settle: 0, void: 0, clear: 0 };
  const sdk = {
    async getRound(_id: bigint) {
      return {
        status: { tag: round.status },
        reveal_round: 1n,
        commit_deadline: round.revealDeadline - 3600n,
        reveal_deadline: round.revealDeadline,
        clearing_rule: { tag: round.rule ?? "HighestBid" },
        bidders: round.bidders,
        winner: round.winner ?? undefined,
        winning_bid: round.winningBid ?? undefined,
        operator: "GOPERATOR",
        item_ref: Buffer.alloc(32),
        auditor_pubkey: Buffer.alloc(0),
      };
    },
    async getBiddersPage(_id: bigint, _cursor: number, _limit: number) {
      const dropped = new Set(round.dropped ?? []);
      return {
        data: round.bidders.filter((bidder) => !dropped.has(bidder)),
        next_cursor: 0,
        total: round.bidders.length,
      };
    },
    async getBidState(_id: bigint, bidder: string) {
      if ((round.unreadable ?? []).includes(bidder)) {
        throw new Error(`HostError: BidNotFound(${bidder})`);
      }
      const state = round.states[bidder];
      if (!state) throw new Error(`HostError: BidNotFound(${bidder})`);
      return {
        commitment: Buffer.alloc(32),
        escrow: state.escrow,
        revealed_nonce: undefined,
        revealed_value: state.revealed,
        settled: false,
        valid: state.revealed != null && state.revealed > 0n,
      };
    },
    async settle(_id: bigint) {
      calls.settle += 1;
    },
    async void(_id: bigint) {
      calls.void += 1;
    },
    async clear(_id: bigint) {
      calls.clear += 1;
      return round.winner ?? undefined;
    },
    async openReveal() {
      throw new Error("openReveal must not run in these tests");
    },
    async *bidders(_id: bigint) {
      for (const bidder of round.bidders) yield bidder;
    },
    async getSeal() {
      return null;
    },
    async reveal() {
      throw new Error("reveal must not run in these tests");
    },
  };
  return { sdk: sdk as unknown as SubRosaClient, calls };
}

function keeperDeps(opts: {
  sdk: SubRosaClient;
  clock: FakeClock;
  guard: SettlementGuard;
  logs?: string[];
}) {
  return {
    sdk: opts.sdk,
    drand: {} as DrandClient,
    log: (message: string) => opts.logs?.push(message),
    time: { clock: opts.clock },
    settlementGuard: opts.guard,
  };
}

function clearedRound(overrides: Partial<FakeRound> = {}): FakeRound {
  return {
    status: "Cleared",
    rule: "HighestBid",
    revealDeadline: BigInt(REVEAL_DEADLINE),
    bidders: ["GAAA", "GBBB"],
    states: {
      GAAA: { escrow: 700n, revealed: 700n },
      GBBB: { escrow: 500n, revealed: 500n },
    },
    winner: "GAAA",
    winningBid: 700n,
    ...overrides,
  };
}

describe("Settlement guard refuses what the contract would reject", () => {
  it("does not submit a settle whose refund the keeper could not read", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(REVEAL_DEADLINE * 1000);
    const { sdk, calls } = createFakeSdk(clearedRound({ unreadable: ["GBBB"] }));

    const res = await closeRound(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.settle, 0, "a settle with a missing refund must not be submitted");
    assert.equal(res.settled, false);
    assert.equal(res.guardSkip?.reason, "refund_missing");
    assert.equal(res.guardSkip?.action, "settle");
    assert.match(res.skipped.join(" "), /refund_missing/);
    // The status endpoint reads the guard entry, not the close result.
    assert.equal(guard.getEntry(1n)?.skip?.reason, "refund_missing");
    assert.equal(guard.getEntry(1n)?.status, "pending", "the refusal is retryable");
  });

  it("does not submit a settle built from a truncated bidder page", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(REVEAL_DEADLINE * 1000);
    const { sdk, calls } = createFakeSdk(
      clearedRound({
        bidders: ["GAAA", "GBBB", "GCCC"],
        states: {
          GAAA: { escrow: 700n, revealed: 700n },
          GBBB: { escrow: 500n, revealed: 500n },
          GCCC: { escrow: 500n, revealed: 500n },
        },
        dropped: ["GCCC"],
      }),
    );

    const res = await closeRound(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.settle, 0, "an incomplete refund set must not be submitted");
    assert.equal(res.guardSkip?.reason, "bidder_page_incomplete");
    assert.equal(guard.getEntry(1n)?.skip?.reason, "bidder_page_incomplete");
  });

  it("does not submit a settle whose local winner disagrees with the chain", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(REVEAL_DEADLINE * 1000);
    const { sdk, calls } = createFakeSdk(
      clearedRound({ winner: "GBBB", winningBid: 500n }),
    );

    const res = await closeRound(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.settle, 0, "a winner mismatch must not be submitted");
    assert.equal(res.guardSkip?.reason, "winner_mismatch");
    assert.match(res.guardSkip!.detail, /GAAA/);
  });

  it("submits a complete, consistent round exactly once", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(REVEAL_DEADLINE * 1000);
    const { sdk, calls } = createFakeSdk(clearedRound());
    const logs: string[] = [];
    const deps = keeperDeps({ sdk, clock, guard, logs });

    const first = await closeRound(deps, 1n);
    assert.equal(calls.settle, 1, "the consistent round must be submitted");
    assert.equal(first.settled, true);
    assert.equal(first.guardSkip, undefined);
    assert.equal(guard.getEntry(1n)?.status, "terminal");

    // Same local view one tick later: the duplicate is suppressed, not
    // resubmitted.
    const second = await closeRound(deps, 1n);
    assert.equal(calls.settle, 1, "a settled-in-flight round must not be submitted twice");
    assert.equal(second.settled, false);
    assert.match(second.skipped.join(" "), /duplicate/);
  });

  it("does not submit a void of a fully revealed round", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(
      (REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1) * 1000,
    );
    const { sdk, calls } = createFakeSdk(
      clearedRound({ status: "Revealing" }),
    );

    const res = await voidIfStale(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.void, 0, "a void of a revealed round must not be submitted");
    assert.equal(res.voided, false);
    assert.equal(res.guardSkip?.reason, "void_not_open");
    assert.equal(res.guardSkip?.action, "void");
    assert.equal(guard.getEntry(1n)?.skip?.reason, "void_not_open");
    assert.match(res.skipped.join(" "), /void_not_open/);
  });

  it("does not submit a void of a cleared round either", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(
      (REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1) * 1000,
    );
    const { sdk, calls } = createFakeSdk(clearedRound());

    const res = await voidIfStale(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.void, 0);
    assert.equal(res.guardSkip?.reason, "void_not_open");
  });

  it("does not submit a void inside the grace window", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock((REVEAL_DEADLINE + 100) * 1000);
    const { sdk, calls } = createFakeSdk(
      clearedRound({ status: "Open", bidders: ["GAAA"], states: { GAAA: { escrow: 700n, revealed: null } }, winner: null, winningBid: null }),
    );

    const res = await voidIfStale(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.void, 0, "an early void must not be submitted");
    assert.equal(res.guardSkip?.reason, "void_grace_not_elapsed");
    assert.equal(guard.getEntry(1n)?.skip?.reason, "void_grace_not_elapsed");
  });

  it("does not submit a void built from a truncated bidder page", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(
      (REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1) * 1000,
    );
    const { sdk, calls } = createFakeSdk(
      clearedRound({
        status: "Open",
        bidders: ["GAAA", "GBBB", "GCCC"],
        states: {
          GAAA: { escrow: 700n, revealed: null },
          GBBB: { escrow: 500n, revealed: null },
          GCCC: { escrow: 500n, revealed: null },
        },
        dropped: ["GCCC"],
        winner: null,
        winningBid: null,
      }),
    );

    const res = await voidIfStale(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.void, 0, "an incomplete void refund set must not be submitted");
    assert.equal(res.guardSkip?.reason, "bidder_page_incomplete");
    assert.equal(guard.getEntry(1n)?.skip?.reason, "bidder_page_incomplete");
  });

  it("submits a stale open void once and only once", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(
      (REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1) * 1000,
    );
    const { sdk, calls } = createFakeSdk(
      clearedRound({ status: "Open", bidders: ["GAAA"], states: { GAAA: { escrow: 700n, revealed: null } }, winner: null, winningBid: null }),
    );
    const deps = keeperDeps({ sdk, clock, guard });

    const first = await voidIfStale(deps, 1n);
    assert.equal(calls.void, 1, "the stale round must be voided");
    assert.equal(first.voided, true);
    assert.equal(guard.getEntry(1n)?.status, "terminal");

    const second = await voidIfStale(deps, 1n);
    assert.equal(calls.void, 1, "a void in flight must not be submitted twice");
    assert.equal(second.voided, false);
    assert.match(second.skipped.join(" "), /duplicate/);
  });

  it("marks an already settled round terminal instead of submitting", async () => {
    const guard = createSettlementGuard();
    const clock = new FakeClock(REVEAL_DEADLINE * 1000);
    const { sdk, calls } = createFakeSdk(clearedRound({ status: "Settled" }));

    const res = await voidIfStale(keeperDeps({ sdk, clock, guard }), 1n);

    assert.equal(calls.void, 0);
    assert.equal(res.guardSkip?.reason, "already_settled");
    assert.equal(guard.getEntry(1n)?.status, "terminal");
    assert.equal(guard.canSettle(1n).allowed, false);
  });
});

// ---------------------------------------------------------------------------
// 6. readSettlementView — the local view is exactly what the guard sees
// ---------------------------------------------------------------------------

describe("readSettlementView", () => {
  it("keeps a truncated index visible as a shorter bidder list", async () => {
    const { sdk } = createFakeSdk(
      clearedRound({
        bidders: ["GAAA", "GBBB", "GCCC"],
        states: {
          GAAA: { escrow: 700n, revealed: 700n },
          GBBB: { escrow: 500n, revealed: 500n },
          GCCC: { escrow: 500n, revealed: 500n },
        },
        dropped: ["GCCC"],
      }),
    );

    const view = await readSettlementView(sdk, 1n, REVEAL_DEADLINE);
    assert.equal(view.bidderTotal, 3, "the contract still reports 3 bidders");
    assert.equal(view.bidders.length, 2, "the keeper only read 2");
    assert.equal(view.status, "Cleared");
    assert.equal(view.winner, "GAAA");
    assert.equal(view.winningBid, 700n);
    assert.equal(view.clearingRule, "HighestBid");
  });

  it("records an unreadable bid state instead of dropping the bidder", async () => {
    const { sdk } = createFakeSdk(clearedRound({ unreadable: ["GBBB"] }));

    const view = await readSettlementView(sdk, 1n, REVEAL_DEADLINE);
    assert.equal(view.bidders.length, 2);
    assert.deepEqual(view.bidders[1], {
      bidder: "GBBB",
      escrow: null,
      revealedValue: null,
      settled: false,
    });
    assert.equal(evaluateSettle(view).allowed, false);
  });

  it("reads a complete round as the contract would settle it", async () => {
    const { sdk } = createFakeSdk(clearedRound());
    const view = await readSettlementView(sdk, 1n, REVEAL_DEADLINE);
    const decision = evaluateSettle(view);
    assert.equal(decision.allowed, true);
    assert.equal(decision.plan.winner, "GAAA");
    assert.equal(decision.plan.operatorPayout, 700n);
    assert.equal(decision.plan.winnerSurplus, 0n);
    assert.deepEqual(decision.plan.refunds, [{ bidder: "GBBB", amount: 500n }]);
  });
});

// ---------------------------------------------------------------------------
// 7. Contract rules with no fixture row of their own
// ---------------------------------------------------------------------------

function bareView(overrides: Partial<RoundSettlementView>): RoundSettlementView {
  return {
    roundId: "1",
    status: "Cleared",
    clearingRule: "HighestBid",
    revealDeadline: REVEAL_DEADLINE,
    nowSeconds: REVEAL_DEADLINE + VOID_GRACE_SECONDS + 1,
    bidders: [],
    bidderTotal: 0,
    winner: null,
    winningBid: null,
    ...overrides,
  };
}

describe("Contract rules the fixture cannot express", () => {
  it("refuses a settle while the round is not Cleared", () => {
    const decision = evaluateSettle(bareView({ status: "Revealing" }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.event.reason, "not_cleared");
  });

  it("refuses a settle with no winner on chain", () => {
    const decision = evaluateSettle(
      bareView({ status: "Cleared", winner: null, winningBid: null }),
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.event.reason, "missing_winner");
  });

  it("refuses a settle of an already settled round and marks it terminal", () => {
    const guard = createSettlementGuard();
    const decision = guard.checkSettle(bareView({ status: "Settled" }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.event.event, "settlement_skipped_contract");
    if (decision.event.event === "settlement_skipped_contract") {
      assert.equal(decision.event.reason, "already_settled");
    }
    assert.equal(guard.getEntry(1n)?.status, "terminal");
    assert.equal(guard.getEntry(1n)?.skip?.reason, "already_settled");
  });

  it("refuses a settle of a voided round", () => {
    const decision = evaluateSettle(bareView({ status: "Voided" }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.event.reason, "round_voided");
  });

  it("refuses a void of a voided round and marks it terminal", () => {
    const guard = createSettlementGuard();
    const decision = guard.checkVoid(bareView({ status: "Voided" }));
    assert.equal(decision.allowed, false);
    if (decision.event.event === "settlement_skipped_contract") {
      assert.equal(decision.event.reason, "round_voided");
    }
    assert.equal(guard.getEntry(1n)?.status, "terminal");
  });

  it("refuses a void of a settled round", () => {
    const guard = createSettlementGuard();
    const decision = guard.checkVoid(bareView({ status: "Settled" }));
    assert.equal(decision.allowed, false);
    if (decision.event.event === "settlement_skipped_contract") {
      assert.equal(decision.event.reason, "already_settled");
    }
    assert.equal(guard.getEntry(1n)?.status, "terminal");
  });

  it("accepts a void exactly one second after the grace window closes", () => {
    const open = bareView({
      status: "Open",
      nowSeconds: REVEAL_DEADLINE + VOID_GRACE_SECONDS,
    });
    const refused = evaluateVoid(open);
    assert.equal(refused.allowed, false);
    assert.equal(refused.event.reason, "void_grace_not_elapsed");

    const allowed = evaluateVoid({ ...open, nowSeconds: open.nowSeconds + 1 });
    assert.equal(allowed.allowed, true, "the contract accepts at deadline + grace + 1");
    assert.deepEqual(allowed.plan.refunds, []);
  });

  it("expectedWinner follows the clearing rule and ignores unrevealed bids", () => {
    const bidders: GuardBidderState[] = [
      { bidder: "B0", escrow: 700n, revealedValue: null, settled: false },
      { bidder: "B1", escrow: 500n, revealedValue: 500n, settled: false },
      { bidder: "B2", escrow: 100n, revealedValue: 0n, settled: false },
      { bidder: "B3", escrow: 900n, revealedValue: 900n, settled: false },
    ];
    assert.deepEqual(
      expectedWinner(bareView({ bidders, bidderTotal: 4 })),
      { bidder: "B3", value: 900n },
    );
    assert.deepEqual(
      expectedWinner(
        bareView({ bidders, bidderTotal: 4, clearingRule: "LowestBid" }),
      ),
      { bidder: "B1", value: 500n },
    );
    assert.equal(
      expectedWinner(
        bareView({
          bidders: [{ bidder: "B0", escrow: null, revealedValue: 700n, settled: false }],
          bidderTotal: 1,
        }),
      ),
      null,
      "an unreadable bid state cannot win a round the keeper cannot price",
    );
  });
});