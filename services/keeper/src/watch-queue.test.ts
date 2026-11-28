// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { createFakeTime } from "@sub-rosa/time";
import type { SubRosaClient } from "@sub-rosa/sdk";
import type { DrandClient } from "@sub-rosa/tlock";

import { KeeperStore } from "./store.js";
import { KeeperQueue } from "./queue.js";
import { createSettlementGuard } from "./settlement-guard.js";
import { runWatchLoop } from "./watch-loop.js";

describe("Watch Mode Queue / Store Integration", () => {
  const TEST_STORE_PATH = path.join(process.cwd(), ".test-keeper-watch-store.json");

  function cleanUp() {
    if (fs.existsSync(TEST_STORE_PATH)) {
      fs.unlinkSync(TEST_STORE_PATH);
    }
  }

  it("should resume rounds properly from the store", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);

    // Simulate previous run saving state
    store.addRound("10", { lastStatus: "Open", contractId: "C123" });
    store.addRound("11", { lastStatus: "Revealing", contractId: "C123" });

    // Simulate restart
    const resumedStore = new KeeperStore(TEST_STORE_PATH);
    const rounds = resumedStore.listRounds();

    assert.strictEqual(rounds.length, 2);
    assert.strictEqual(rounds[0].roundId, "10");
    assert.strictEqual(rounds[1].roundId, "11");

    // Active round filtering logic identical to watch.ts
    const activeRounds = rounds.filter((r) => {
      if (r.contractId && r.contractId !== "C123") return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    // Both should be resumed and active
    assert.strictEqual(activeRounds.length, 2);
    cleanUp();
  });

  it("should filter out completed rounds (Settled or Voided) from active polling", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);

    store.addRound("10", { lastStatus: "Open", contractId: "C123" });
    store.addRound("11", { lastStatus: "Settled", contractId: "C123" });
    store.addRound("12", { lastStatus: "Voided", contractId: "C123" });

    const rounds = store.listRounds();

    // All 3 remain in the store for record-keeping
    assert.strictEqual(rounds.length, 3);

    // Cleanup / Pruning from active poll:
    const activeRounds = rounds.filter((r) => {
      if (r.contractId && r.contractId !== "C123") return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    // Only round 10 should be polled
    assert.strictEqual(activeRounds.length, 1);
    assert.strictEqual(activeRounds[0].roundId, "10");
    cleanUp();
  });

  it("ensures a round is not both in-flight and still queued", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    const queue = new KeeperQueue(store);

    queue.enqueue("10", { lastStatus: "Open" });
    queue.enqueue("11", { lastStatus: "Open" });

    assert.strictEqual(queue.isQueued("10"), true);
    assert.strictEqual(queue.isInFlight("10"), false);
    assert.strictEqual(queue.size(), 2);
    assert.strictEqual(queue.inFlightCount(), 0);

    const claimed = queue.claim();
    assert.strictEqual(claimed?.roundId, "10");

    // Must be in-flight and NOT queued
    assert.strictEqual(queue.isInFlight("10"), true);
    assert.strictEqual(queue.isQueued("10"), false);
    assert.strictEqual(queue.isQueued("10") && queue.isInFlight("10"), false);

    assert.deepStrictEqual(
      queue.getQueuedRounds().map((r) => r.roundId),
      ["11"],
    );
    assert.deepStrictEqual(
      queue.getInFlightRounds().map((r) => r.roundId),
      ["10"],
    );

    // Attempting to enqueue an in-flight round does not add it back to queued
    queue.enqueue("10");
    assert.strictEqual(queue.isInFlight("10"), true);
    assert.strictEqual(queue.isQueued("10"), false);

    cleanUp();
  });

  it("stops claiming new rounds as soon as shutdown starts", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    const queue = new KeeperQueue(store);

    queue.enqueue("10", { lastStatus: "Open" });
    queue.enqueue("11", { lastStatus: "Open" });

    queue.stop();
    assert.strictEqual(queue.isStopping(), true);

    const claimed = queue.claim();
    assert.strictEqual(claimed, undefined);
    assert.strictEqual(queue.isQueued("10"), true);
    assert.strictEqual(queue.isQueued("11"), true);
    assert.strictEqual(queue.inFlightCount(), 0);

    cleanUp();
  });

  it("shutdown during an in-flight settle waits for that settle and does not start another (fake clock)", async () => {
    cleanUp();
    const fakeTime = createFakeTime(1_000_000_000_000);
    const store = new KeeperStore(TEST_STORE_PATH);
    const settlementGuard = createSettlementGuard(fakeTime.clock);

    // Round 20 is Cleared and ready to settle; Round 21 is Open and waiting
    store.addRound("20", { lastStatus: "Cleared", contractId: "C1" });
    store.addRound("21", { lastStatus: "Open", contractId: "C1" });

    let round20SettleStarted = false;
    let round20SettleResolve: (() => void) | undefined;
    const round20SettlePromise = new Promise<void>((resolve) => {
      round20SettleResolve = resolve;
    });

    let round21Started = false;
    let stopping = false;

    const mockRoundStates: Record<string, { status: string; winner?: string }> = {
      "20": { status: "Cleared", winner: "GWINNER" },
      "21": { status: "Open" },
    };

    const mockSdk = {
      getRound: async (id: bigint) => {
        if (id === 21n) {
          round21Started = true;
        }
        const state = mockRoundStates[id.toString()];
        if (!state) throw new Error("RoundNotFound");
        return {
          status: { tag: state.status },
          reveal_round: 1n,
          reveal_deadline: 1_000_000n,
          winner: state.winner,
        };
      },
      settle: async (id: bigint) => {
        if (id === 20n) {
          round20SettleStarted = true;
          await round20SettlePromise;
          mockRoundStates["20"].status = "Settled";
        }
      },
      bidders: async function* () {},
      getSeal: async () => null,
      getBidState: async () => ({ revealed_value: null }),
      clear: async () => "GWINNER",
      void: async () => {},
      openReveal: async () => {},
    } as unknown as SubRosaClient;

    const mockDrand = {
      chain: () => ({
        info: async () => ({ genesis_time: 0, period: 3 }),
      }),
    } as unknown as DrandClient;

    const loopPromise = runWatchLoop({
      sdk: mockSdk,
      drand: mockDrand,
      log: () => {},
      pollMs: 1000,
      contractId: "C1",
      network: "testnet",
      store,
      settlementGuard,
      isStopping: () => stopping,
      time: fakeTime,
    });

    // Wait until round 20 settle starts
    while (!round20SettleStarted) {
      await new Promise((r) => setImmediate(r));
    }

    // While settle is in-flight, signal shutdown
    stopping = true;

    // Settle has started, and while in flight, round 21 must NOT have started
    assert.strictEqual(round20SettleStarted, true);
    assert.strictEqual(round21Started, false);

    // Resolve the in-flight settle
    round20SettleResolve!();

    // The watch loop must finish waiting for round 20 and then exit
    await loopPromise;

    // Settle completed
    assert.strictEqual(store.getRound("20")?.lastStatus, "Settled");
    assert.strictEqual(settlementGuard.getEntry(20n)?.status, "terminal");

    // Round 21 was never started or claimed
    assert.strictEqual(round21Started, false);
    assert.strictEqual(store.getRound("21")?.lastStatus, "Open");

    cleanUp();
  });

  it("persists queued but unclaimed rounds across restart and sees them exactly once", async () => {
    cleanUp();
    const fakeTime = createFakeTime(1_000_000_000_000);
    const store = new KeeperStore(TEST_STORE_PATH);
    const settlementGuard = createSettlementGuard(fakeTime.clock);

    // Populate store: 20 is already Settled (terminal), 21 is Open (unclaimed)
    store.addRound("20", { lastStatus: "Settled", contractId: "C1" });
    store.addRound("21", { lastStatus: "Open", contractId: "C1" });

    // Simulate restart with a fresh store and queue instance from the persisted file
    const restartedStore = new KeeperStore(TEST_STORE_PATH);
    const restartedQueue = new KeeperQueue(restartedStore, { contractId: "C1" });

    // Terminal round 20 must NOT be in queue
    assert.strictEqual(restartedQueue.isQueued("20"), false);

    // Unclaimed round 21 MUST be in queue
    assert.strictEqual(restartedQueue.isQueued("21"), true);
    assert.strictEqual(restartedQueue.size(), 1);

    const queuedRounds = restartedQueue.getQueuedRounds();
    assert.strictEqual(queuedRounds.length, 1);
    assert.strictEqual(queuedRounds[0].roundId, "21");

    // Claim round 21: seen exactly once
    const claimedFirst = restartedQueue.claim();
    assert.strictEqual(claimedFirst?.roundId, "21");
    assert.strictEqual(restartedQueue.size(), 0);

    const claimedSecond = restartedQueue.claim();
    assert.strictEqual(claimedSecond, undefined);

    cleanUp();
  });

  it("bounds in-flight round execution by the fake clock timeout on shutdown", async () => {
    cleanUp();
    const fakeTime = createFakeTime(1_000_000_000_000);
    const store = new KeeperStore(TEST_STORE_PATH);
    const settlementGuard = createSettlementGuard(fakeTime.clock);

    store.addRound("30", { lastStatus: "Cleared", contractId: "C1" });

    let settleStarted = false;
    let stopping = false;

    // Settle that hangs indefinitely (never resolves)
    const mockSdk = {
      getRound: async () => ({
        status: { tag: "Cleared" },
        reveal_round: 1n,
        reveal_deadline: 1_000_000n,
        winner: "GWINNER",
      }),
      settle: async () => {
        settleStarted = true;
        return new Promise(() => {}); // never resolves
      },
      bidders: async function* () {},
      getSeal: async () => null,
      getBidState: async () => ({ revealed_value: null }),
      clear: async () => "GWINNER",
      void: async () => {},
      openReveal: async () => {},
    } as unknown as SubRosaClient;

    const mockDrand = {
      chain: () => ({
        info: async () => ({ genesis_time: 0, period: 3 }),
      }),
    } as unknown as DrandClient;

    const loopPromise = runWatchLoop({
      sdk: mockSdk,
      drand: mockDrand,
      log: () => {},
      pollMs: 1000,
      contractId: "C1",
      network: "testnet",
      store,
      settlementGuard,
      isStopping: () => stopping,
      time: fakeTime,
      shutdownTimeoutMs: 200,
    });

    while (!settleStarted) {
      await new Promise((r) => setImmediate(r));
    }

    // Trigger shutdown
    stopping = true;

    // Advance fake scheduler so check detects stopping and timeout fires
    fakeTime.scheduler.advance(50);
    fakeTime.scheduler.advance(250);

    // Loop must terminate via bounded timeout and not hang indefinitely
    await loopPromise;

    // Guard should record the failure as retryable, NOT stuck terminal
    const guardEntry = settlementGuard.getEntry(30n);
    assert.strictEqual(guardEntry?.status, "pending");

    // Store preserves the round with error recorded
    const roundInStore = store.getRound("30");
    assert.ok(roundInStore?.lastError?.includes("Shutdown timeout"));

    cleanUp();
  });
});
