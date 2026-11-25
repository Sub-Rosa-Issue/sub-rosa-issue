// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { KeeperStore } from "./store.js";
import { runWatchLoop, validateStoredCheckpoint } from "./watch-loop.js";
import { createSettlementGuard } from "./settlement-guard.js";

describe("Keeper Startup Checkpoint Validation", () => {
  const TEST_STORE_PATH = path.join(process.cwd(), ".test-checkpoint-store.json");

  function cleanUp() {
    if (fs.existsSync(TEST_STORE_PATH)) {
      fs.unlinkSync(TEST_STORE_PATH);
    }
  }

  it("an empty store starts without a cursor and allows startup", async () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(store.listRounds(), []);
    const rounds = store.listRounds();
    assert.doesNotThrow(() => validateStoredCheckpoint(rounds, { contractId: "C1", network: "net1" }));
    cleanUp();
  });

  it("refuses startup on contract or network mismatch when store has rounds", async () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(1n, { contractId: "C_OTHER", network: "other-net", lastStatus: "Open" });

    let started = false;
    const isStopping = () => {
      started = true;
      return true;
    };

    const dummySdk = {} as any;
    const dummyDrand = {} as any;
    const log = () => {};
    const settlementGuard = createSettlementGuard();

    await assert.rejects(
      async () => {
        await runWatchLoop({
          sdk: dummySdk,
          drand: dummyDrand,
          log,
          pollMs: 100,
          contractId: "C_CURRENT",
          network: "Test SDF Network ; September 2015",
          store,
          settlementGuard,
          isStopping,
        });
      },
      (err: any) => {
        const msg = err.message;
        assert.ok(msg.includes("network") || msg.includes("contractId"), "error names the mismatched field");
        assert.ok(!msg.includes("S_"), "does not print a secret key");
        return true;
      }
    );

    cleanUp();
  });

  it("a matching checkpoint starts the loop in the test", async () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(1n, { contractId: "C_CURRENT", network: "Test SDF Network ; September 2015", lastStatus: "Open" });

    const rounds = store.listRounds();
    assert.doesNotThrow(() => validateStoredCheckpoint(rounds, { contractId: "C_CURRENT", network: "Test SDF Network ; September 2015" }));

    cleanUp();
  });
});
