import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { KeeperStore } from "./store.js";

describe("KeeperStore", () => {
  const TEST_STORE_PATH = path.join(process.cwd(), ".test-keeper-store.json");

  function cleanUp() {
    if (fs.existsSync(TEST_STORE_PATH)) {
      fs.unlinkSync(TEST_STORE_PATH);
    }
    // Also cleanup corrupted backups
    const files = fs.readdirSync(process.cwd());
    for (const f of files) {
      if (f.startsWith(".test-keeper-store.json.corrupted.")) {
        fs.unlinkSync(path.join(process.cwd(), f));
      }
    }
  }

  it("should create an empty store if none exists", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(store.listRounds(), []);
    cleanUp();
  });

  it("should add and retrieve a round", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(42n, { contractId: "C123", network: "test" });
    const rounds = store.listRounds();
    assert.strictEqual(rounds.length, 1);
    assert.strictEqual(rounds[0].roundId, "42");
    assert.strictEqual(rounds[0].contractId, "C123");
    assert.strictEqual(rounds[0].lastStatus, "Unknown");
    cleanUp();
  });

  it("should handle duplicates gracefully", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(1, { lastStatus: "Open" });
    store.addRound("1", { retryCount: 5 }); // Should merge
    const rounds = store.listRounds();
    assert.strictEqual(rounds.length, 1);
    assert.strictEqual(rounds[0].roundId, "1");
    assert.strictEqual(rounds[0].lastStatus, "Open");
    assert.strictEqual(rounds[0].retryCount, 5);
    cleanUp();
  });

  it("should remove a round", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(10);
    assert.strictEqual(store.listRounds().length, 1);
    store.removeRound("10");
    assert.strictEqual(store.listRounds().length, 0);
    cleanUp();
  });

  it("should handle corrupted json by creating a backup", () => {
    cleanUp();
    fs.writeFileSync(TEST_STORE_PATH, "{ corrupted json ! }", "utf-8");
    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(store.listRounds(), []);
    store.addRound(99);

    // Check if backup was created
    const files = fs.readdirSync(process.cwd());
    const backups = files.filter(f => f.startsWith(".test-keeper-store.json.corrupted."));
    assert.strictEqual(backups.length, 1);
    cleanUp();
  });
});
