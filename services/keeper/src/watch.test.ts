import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discoverRoundIds,
  parseRoundIdSpec,
} from "./index.js";

test("parseRoundIdSpec handles singles and ranges", () => {
  assert.deepEqual(parseRoundIdSpec("1,3,5"), [1n, 3n, 5n]);
  assert.deepEqual(parseRoundIdSpec("1-3"), [1n, 2n, 3n]);
  assert.deepEqual(parseRoundIdSpec("2, 4-6"), [2n, 4n, 5n, 6n]);
});

test("discoverRoundIds stops at RoundNotFound", async () => {
  const reader = {
    getRound: async (id: bigint) => {
      if (id <= 3n) return { status: { tag: "Open" } };
      throw new Error("HostError: RoundNotFound(3)");
    },
  };

  const ids = await discoverRoundIds(reader as Pick<import("@sub-rosa/sdk").SubRosaClient, "getRound">, { from: 1n, maxProbe: 10 });
  assert.deepEqual(ids, [1n, 2n, 3n]);
});

test("discoverRoundIds returns empty when first round missing", async () => {
  const reader = {
    getRound: async () => {
      throw new Error("RoundNotFound");
    },
  };
  const ids = await discoverRoundIds(reader as Pick<import("@sub-rosa/sdk").SubRosaClient, "getRound">, { from: 1n, maxProbe: 5 });
  assert.deepEqual(ids, []);
});

test("watch loop handles graceful shutdown during a queued round", async () => {
  const { KeeperStore } = await import("./store.js");
  const { createSettlementGuard } = await import("./settlement-guard.js");
  const { runWatchLoop } = await import("./watch-loop.js");

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();
  
  store.addRound(100n, { contractId: "C1", network: "test" });
  store.addRound(101n, { contractId: "C1", network: "test" });

  let callCount = 0;
  let processedRoundBeforeStop = false;
  
  const isStopping = () => {
    callCount++;
    if (callCount > 2) {
      processedRoundBeforeStop = true;
      return true; 
    }
    return false;
  };

  const mockSdk = {
    getRound: async () => { throw new Error("mock error"); }
  } as any;

  const loopPromise = runWatchLoop({
    sdk: mockSdk,
    drand: {} as any,
    log: () => {},
    pollMs: 10,
    contractId: "C1",
    network: "test",
    store,
    settlementGuard,
    isStopping,
  });

  await loopPromise;
  assert.ok(processedRoundBeforeStop, "gracefully stopped without hanging");
});
