// Copyright (c) 2026 Sub Rosa contributors
// checkpoint-restart.test.ts
//
// Restart-resilience coverage for the keeper watch cursor.
//
// Two crash points are exercised for every irreversible step:
//
//   crash BEFORE the checkpoint write — the step is retried on restart, the
//   contract's idempotent rejection downgrades it to a skip, and the keeper
//   records it so the *next* restart is quiet.
//
//   crash AFTER the checkpoint write — the step is not re-broadcast, even when
//   the RPC replica the keeper reads is still behind (a "lagging replica"
//   Cleared status must not re-settle a settled round).
//
// Every scenario runs on a fake clock and an in-memory chain: no RPC, no Drand,
// no signing material.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { Round, SubRosaClient } from "@sub-rosa/sdk";
import { createFakeTime, type FakeClock, type FakeScheduler } from "@sub-rosa/time";

import {
  CHECKPOINT_VERSION,
  KeeperCheckpointStore,
  type KeeperCheckpointFile,
  type KeeperStep,
  type TransactionHashStatus,
} from "./checkpoint.js";
import { closeRound, keepRound, voidIfStale, watchRound } from "./keeper.js";
import { createSettlementGuard } from "./settlement-guard.js";
import { KeeperStore } from "./store.js";
import { resumeCheckpoint, runWatchLoop } from "./watch-loop.js";
import { FileSubmissionJournal } from "./submission-journal.js";

const NETWORK = "Test SDF Network ; September 2015";
const CONTRACT = "CTESTCONTRACT";
/** 2023-11-14T22:13:20Z — comfortably past the fixture reveal deadline. */
const NOW_MS = 1_700_000_000_000;
const REVEAL_DEADLINE = 1_699_900_000n;
const ROUND_ID = 1n;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let dir: string;
let file: string;
let clock: FakeClock;
let scheduler: FakeScheduler;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-restart-"));
  file = path.join(dir, "checkpoint.json");
  ({ clock, scheduler } = createFakeTime(NOW_MS));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("durable submission journal", () => {
  test("persists operation metadata and pending hashes across store instances", async () => {
    const journalPath = path.join(dir, "submissions.json");
    const journal = new FileSubmissionJournal({ network: NETWORK, contractId: CONTRACT, path: journalPath });
    const identity = { operation: "settle", roundId: "1", network: NETWORK, contractId: CONTRACT };
    const record = {
      ...identity,
      hash: "0xpendinghash",
      state: "pending" as const,
      submittedAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 60_000,
    };
    await journal.put(record);

    const restarted = new FileSubmissionJournal({ network: NETWORK, contractId: CONTRACT, path: journalPath });
    assert.deepEqual(await restarted.get(identity), record);
    assert.doesNotMatch(fs.readFileSync(journalPath, "utf8"), /signed-xdr|SECRET/);
  });

  test("refuses to resume a journal bound to another network", () => {
    const journalPath = path.join(dir, "wrong-network.json");
    new FileSubmissionJournal({ network: NETWORK, contractId: CONTRACT, path: journalPath });
    assert.throws(
      () => new FileSubmissionJournal({ network: "Public Network", contractId: CONTRACT, path: journalPath }),
      /does not match configured/,
    );
  });
});

// ── In-memory chain ────────────────────────────────────────────────────────

interface FakeChainOptions {
  status: string;
  bidders?: string[];
  /** Keep the reported status fixed even after mutations (lagging replica). */
  stickyStatus?: boolean;
}

/**
 * Minimal stand-in for `SubRosaClient`. Mutation methods record every
 * broadcast so a test can assert that a step was *not* re-submitted, and
 * `settleOnce`-style flags model the contract's idempotent rejections.
 */
class FakeChain {
  calls: string[] = [];
  status: string;
  bidderList: string[];
  private readonly stickyStatus: boolean;

  constructor(options: FakeChainOptions) {
    this.status = options.status;
    this.bidderList = options.bidders ?? [];
    this.stickyStatus = options.stickyStatus ?? false;
  }

  private advance(status: string): void {
    if (!this.stickyStatus) this.status = status;
  }

  async getRound(roundId: bigint | number = ROUND_ID): Promise<Round> {
    this.calls.push("getRound");
    if (BigInt(roundId) !== ROUND_ID) throw new Error("HostError: RoundNotFound(1)");
    return {
      auditor_pubkey: Buffer.alloc(32),
      bidders: this.bidderList,
      clearing_rule: { tag: "HighestBid", values: undefined },
      commit_deadline: REVEAL_DEADLINE - 3_600n,
      item_ref: Buffer.alloc(32),
      operator: "GOPERATOR",
      reveal_deadline: REVEAL_DEADLINE,
      reveal_round: 42n,
      status: { tag: this.status, values: undefined },
      winner: undefined,
      winning_bid: 0n,
    } as unknown as Round;
  }

  async *bidders(): AsyncGenerator<string> {
    this.calls.push("bidders");
    for (const bidder of this.bidderList) yield bidder;
  }

  async getBidState(): Promise<never> {
    this.calls.push("getBidState");
    throw new Error("getBidState must not run when the cursor records reveals");
  }

  async getSeal(): Promise<never> {
    this.calls.push("getSeal");
    throw new Error("getSeal must not run when the cursor records reveals");
  }

  async openReveal(): Promise<void> {
    this.calls.push("openReveal");
    this.advance("Revealing");
  }

  async reveal(): Promise<void> {
    this.calls.push("reveal");
  }

  async clear(): Promise<string | undefined> {
    this.calls.push("clear");
    this.advance("Cleared");
    return "GWINNER";
  }

  async settle(): Promise<void> {
    this.calls.push("settle");
    this.advance("Settled");
  }

  async void(): Promise<void> {
    this.calls.push("void");
    this.advance("Voided");
  }

  count(call: string): number {
    return this.calls.filter((c) => c === call).length;
  }
}

function asSdk(chain: FakeChain): SubRosaClient {
  return chain as unknown as SubRosaClient;
}

function newStore(options: { dryRun?: boolean } = {}): KeeperCheckpointStore {
  return new KeeperCheckpointStore({
    path: file,
    network: NETWORK,
    contractId: CONTRACT,
    clock,
    logger: silentLogger,
    ...options,
  });
}

/** Seed a cursor as a previous process would have left it on disk. */
function seedCheckpoint(
  steps: KeeperStep[],
  hashes: Partial<Record<KeeperStep, string>> = {},
): void {
  const rounds: KeeperCheckpointFile["rounds"] = {};
  for (const [index, step] of steps.entries()) {
    rounds[ROUND_ID.toString()] = {
      roundId: ROUND_ID.toString(),
      completedSteps: steps.slice(0, index + 1),
      lastCompletedStep: step,
      lastTransactionHash: hashes[steps[steps.length - 1]] ?? null,
      stepHashes: Object.fromEntries(
        steps.slice(0, index + 1).flatMap((s) => (hashes[s] ? [[s, hashes[s]]] : [])),
      ),
      updatedAt: clock.toISOString(),
    };
  }
  fs.writeFileSync(
    file,
    JSON.stringify(
      { version: CHECKPOINT_VERSION, network: NETWORK, contractId: CONTRACT, rounds },
      null,
      2,
    ),
    "utf-8",
  );
}

function readCheckpoint(): KeeperCheckpointFile {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as KeeperCheckpointFile;
}

const confirmAll = async (): Promise<TransactionHashStatus> => "confirmed";

// ── Crash AFTER the checkpoint write ───────────────────────────────────────

describe("restart after the checkpoint was written", () => {
  test("recovers a confirmed settle hash written before a crash, without rebroadcasting", async () => {
    const chain = new FakeChain({ status: "Cleared" });
    const sdk = asSdk(chain);
    Object.defineProperty(sdk, "reconcileSubmission", {
      value: async () => ({ hash: "0xaccepted-settle", state: "confirmed" }),
    });
    const checkpoint = newStore();

    const result = await closeRound(
      { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint },
      ROUND_ID,
    );

    assert.equal(result.settled, true);
    assert.equal(chain.count("settle"), 0);
    assert.equal(checkpoint.isComplete(ROUND_ID, "settle"), true);
    assert.equal(checkpoint.read(ROUND_ID)?.stepHashes.settle, "0xaccepted-settle");
  });

  test("keeps an unresolved settle pending instead of creating another transaction", async () => {
    const chain = new FakeChain({ status: "Cleared" });
    const sdk = asSdk(chain);
    Object.defineProperty(sdk, "reconcileSubmission", {
      value: async () => ({ hash: "0xstill-pending", state: "pending" }),
    });

    await assert.rejects(
      closeRound(
        { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint: newStore() },
        ROUND_ID,
      ),
      /still pending/,
    );
    assert.equal(chain.count("settle"), 0);
  });

  test("replaces an expired settle hash with exactly one new submission", async () => {
    const chain = new FakeChain({ status: "Cleared" });
    const sdk = asSdk(chain);
    Object.defineProperty(sdk, "reconcileSubmission", {
      value: async () => ({ hash: "0xexpired-settle", state: "expired" }),
    });

    const result = await closeRound(
      { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint: newStore() },
      ROUND_ID,
    );
    assert.equal(result.settled, true);
    assert.equal(chain.count("settle"), 1);
  });

  test("a confirmed settle is not submitted again by a lagging replica", async () => {
    // The round reads "Cleared" because our RPC replica is behind — the settle
    // transaction is already on the network, and the cursor proves it.
    const chain = new FakeChain({ status: "Cleared" });
    seedCheckpoint(["open-reveal", "reveal", "clear", "settle"], {
      settle: "0xsethash",
    });
    const checkpoint = newStore();

    const log: string[] = [];
    await resumeCheckpoint({
      checkpoint,
      sdk: asSdk(chain),
      log: (m) => log.push(m),
      verifyTransaction: confirmAll,
    });

    const tick = await watchRound(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(chain.count("settle"), 0, "settle must not be re-broadcast");
    assert.ok(log.some((line) => line.includes("confirmed settle for round 1")));
    assert.ok(
      tick.close?.skipped.includes("settle already complete (checkpoint)"),
      `expected a checkpoint skip, got ${JSON.stringify(tick.close?.skipped)}`,
    );
    assert.equal(tick.close?.settled, false);
    assert.equal(tick.finalStatus, "Cleared");
  });

  test("a confirmed clear is not submitted again", async () => {
    const chain = new FakeChain({ status: "Revealing" });
    seedCheckpoint(["open-reveal", "reveal", "clear"], { clear: "0xclearhash" });
    const checkpoint = newStore();
    await checkpoint.verifyHashes(confirmAll);

    const result = await closeRound(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(chain.count("clear"), 0, "clear must not be re-broadcast");
    assert.ok(result.skipped.includes("clear already complete (checkpoint)"));
    assert.equal(result.cleared, false);
  });

  test("a confirmed void is not submitted again", async () => {
    const chain = new FakeChain({ status: "Open" });
    seedCheckpoint(["void"], { void: "0xvoidhash" });
    const checkpoint = newStore();
    await checkpoint.verifyHashes(confirmAll);

    const result = await voidIfStale(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(chain.count("void"), 0, "void must not be re-broadcast");
    assert.ok(result.skipped.includes("void already complete (checkpoint)"));
    assert.equal(result.voided, false);
  });

  test("recorded reveals skip the per-bidder pass entirely", async () => {
    const chain = new FakeChain({ status: "Revealing", bidders: ["G1", "G2"] });
    seedCheckpoint(["open-reveal", "reveal"], { reveal: "0xrevealhash" });
    const checkpoint = newStore();
    await checkpoint.verifyHashes(confirmAll);

    const result = await keepRound(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(chain.count("bidders"), 0, "no seal reads on a resumed cursor");
    assert.equal(chain.count("getBidState"), 0);
    assert.equal(chain.count("reveal"), 0);
    assert.deepEqual(result.revealed, []);
    assert.ok(
      result.skipped.some((s) => s.reason === "reveals complete (checkpoint)"),
    );
  });
});

// ── Crash BEFORE the checkpoint write ──────────────────────────────────────

describe("restart before the checkpoint was written", () => {
  test("the step is retried, downgraded to a skip, and then recorded", async () => {
    const chain = new FakeChain({ status: "Cleared", stickyStatus: true });
    // The contract is idempotent: a second settle is rejected, not executed.
    const sdk = {
      ...chain,
      getRound: () => chain.getRound(),
      settle: async () => {
        chain.calls.push("settle");
        if (chain.count("settle") > 1) throw new Error("HostError: AlreadySettled(1)");
      },
    } as unknown as SubRosaClient;

    // Pass 1: settle lands, then the process dies before the checkpoint write.
    const crashing = newStore({ dryRun: true });
    const first = await closeRound(
      { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint: crashing },
      ROUND_ID,
    );
    assert.equal(first.settled, true);
    assert.equal(chain.count("settle"), 1);
    assert.equal(fs.existsSync(file), false, "crash-before leaves no checkpoint");

    // Pass 2 (restart): the cursor knows nothing, so settle is broadcast again
    // and the contract's idempotent rejection is recorded as completion.
    const restarted = newStore();
    const second = await closeRound(
      { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint: restarted },
      ROUND_ID,
    );
    assert.equal(second.settled, false);
    assert.equal(chain.count("settle"), 2);
    assert.ok(
      second.skipped.some((line) => line.includes("AlreadySettled")),
      `expected an idempotent skip, got ${JSON.stringify(second.skipped)}`,
    );
    assert.equal(restarted.isComplete(ROUND_ID, "settle"), true);
    assert.deepEqual(readCheckpoint().rounds["1"].completedSteps, ["settle"]);

    // Pass 3 (restart again): the cursor now stops the broadcast for good.
    const third = newStore();
    await third.verifyHashes(confirmAll);
    await closeRound(
      { sdk, drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint: third },
      ROUND_ID,
    );
    assert.equal(chain.count("settle"), 2, "settle is broadcast at most twice");
  });

  test("a lost cursor is rebuilt from the chain, not trusted blindly", async () => {
    // A cursor written before the crash, with no transaction hash to confirm, on
    // a replica that says the round never settled: retry instead of stranding.
    const chain = new FakeChain({ status: "Cleared" });
    seedCheckpoint(["settle"]);
    const checkpoint = newStore();
    const log: string[] = [];

    await resumeCheckpoint({
      checkpoint,
      sdk: asSdk(chain),
      log: (m) => log.push(m),
      verifyTransaction: confirmAll,
    });

    assert.equal(checkpoint.isComplete(ROUND_ID, "settle"), false);
    assert.ok(log.some((line) => line.includes("retrying settle")));

    await closeRound(
      { sdk: asSdk(chain), drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint },
      ROUND_ID,
    );
    assert.equal(chain.count("settle"), 1, "the unprovable step is retried");
  });

  test("a hash that failed on the network is retried on the next pass", async () => {
    const chain = new FakeChain({ status: "Cleared" });
    seedCheckpoint(["clear", "settle"], { clear: "0xclearhash", settle: "0xsethash" });
    const checkpoint = newStore();

    const verifications = await checkpoint.verifyHashes(async (hash) =>
      hash === "0xsethash" ? "failed" : "confirmed",
    );

    assert.deepEqual(
      verifications.map((v) => [v.step, v.retained]),
      [
        ["clear", true],
        ["settle", false],
      ],
    );
    assert.equal(checkpoint.isComplete(ROUND_ID, "settle"), false);
    assert.equal(checkpoint.isComplete(ROUND_ID, "clear"), true);

    await closeRound(
      { sdk: asSdk(chain), drand: {} as never, log: () => {}, time: { clock, scheduler }, checkpoint },
      ROUND_ID,
    );
    assert.equal(chain.count("settle"), 1, "the failed step is retried");
  });

  test("an unreadable round during reconciliation keeps the cursor", async () => {
    seedCheckpoint(["settle"], { settle: "0xsethash" });
    const checkpoint = newStore();
    const log: string[] = [];

    await resumeCheckpoint({
      checkpoint,
      sdk: {
        getRound: async () => {
          throw new Error("HostError: ConnectionError");
        },
      } as unknown as SubRosaClient,
      log: (m) => log.push(m),
      verifyTransaction: confirmAll,
    });

    assert.equal(checkpoint.isComplete(ROUND_ID, "settle"), true);
    assert.ok(log.some((line) => line.includes("could not read round 1")));
  });
});

// ── Recording ──────────────────────────────────────────────────────────────

describe("cursor recording", () => {
  test("a cleared round records reveal, clear, and settle with their hashes", async () => {
    const chain = new FakeChain({ status: "Revealing" });
    const checkpoint = newStore();

    const result = await watchRound(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(result.close?.cleared, true);
    assert.equal(result.close?.settled, true);
    const written = readCheckpoint().rounds["1"];
    assert.deepEqual(written.completedSteps, ["reveal", "clear", "settle"]);
    assert.equal(written.lastCompletedStep, "settle");
    assert.equal(written.lastTransactionHash, null, "the SDK returns no tx hash");
    assert.equal(written.updatedAt, clock.toISOString());
  });

  test("a round with no bids still records the reveal step", async () => {
    const chain = new FakeChain({ status: "Revealing", bidders: [] });
    const checkpoint = newStore();

    await keepRound(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(checkpoint.isComplete(ROUND_ID, "reveal"), true);
    assert.equal(chain.count("reveal"), 0);
  });

  test("a stale round records the void step", async () => {
    const chain = new FakeChain({ status: "Open" });
    const checkpoint = newStore();

    const result = await voidIfStale(
      {
        sdk: asSdk(chain),
        drand: {} as never,
        log: () => {},
        time: { clock, scheduler },
        checkpoint,
      },
      ROUND_ID,
    );

    assert.equal(result.voided, true);
    assert.equal(checkpoint.isComplete(ROUND_ID, "void"), true);
  });
});

// ── Watch loop integration ─────────────────────────────────────────────────

describe("watch loop restart", () => {
  test("a resumed watch loop does not settle a round the cursor already settled", async () => {
    const chain = new FakeChain({ status: "Cleared" });
    seedCheckpoint(["open-reveal", "reveal", "clear", "settle"], {
      settle: "0xsethash",
    });
    const store = new KeeperStore(path.join(dir, "queue.json"), silentLogger);
    store.addRound(ROUND_ID, { contractId: CONTRACT, network: NETWORK, lastStatus: "Cleared" });

    let stopChecks = 0;
    const logs: string[] = [];

    await runWatchLoop({
      sdk: asSdk(chain),
      drand: {} as never,
      log: (m) => logs.push(m),
      pollMs: 0,
      contractId: CONTRACT,
      network: NETWORK,
      store,
      settlementGuard: createSettlementGuard(clock),
      checkpoint: newStore(),
      verifyTransaction: confirmAll,
      isStopping: () => stopChecks++ >= 3,
      time: { clock, scheduler },
    });

    assert.equal(chain.count("settle"), 0, "the watch loop must not resettle");
    assert.ok(
      logs.some((line) => line.includes("confirmed settle for round 1")),
      `expected a confirmed-settle log line, got ${JSON.stringify(logs)}`,
    );
  });
});
