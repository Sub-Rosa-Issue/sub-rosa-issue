import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { KeeperStore, normalizeRoundId } from "./store.js";

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
    store.addRound(1n, { retryCount: 3 });
    store.addRound("01", { retryCount: 5 }); // Should normalize and merge
    const rounds = store.listRounds();
    assert.strictEqual(rounds.length, 1);
    assert.strictEqual(rounds[0].roundId, "1");
    assert.strictEqual(rounds[0].lastStatus, "Open");
    assert.strictEqual(rounds[0].retryCount, 5);
    cleanUp();
  });

  it("normalizes valid round ID input types", () => {
    assert.strictEqual(normalizeRoundId(42), "42");
    assert.strictEqual(normalizeRoundId(42n), "42");
    assert.strictEqual(normalizeRoundId(" 0042 "), "42");
  });

  it("rejects zero, negative, fractional, unsafe, empty, and non-numeric IDs", () => {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 0n, -1n, "", " ", "abc", "1.5", "-1"]) {
      assert.throws(() => normalizeRoundId(invalid), /positive integer/);
    }
  });

  it("does not persist an invalid round ID", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);
    store.addRound(7);
    const before = fs.readFileSync(TEST_STORE_PATH, "utf-8");

    assert.throws(() => store.addRound("invalid"), /positive integer/);
    assert.strictEqual(fs.readFileSync(TEST_STORE_PATH, "utf-8"), before);
    assert.deepEqual(store.listRounds().map((round) => round.roundId), ["7"]);
    cleanUp();
  });

  it("backs up persisted data with an invalid round ID before sorting", () => {
    cleanUp();
    fs.writeFileSync(
      TEST_STORE_PATH,
      JSON.stringify({ rounds: { invalid: { roundId: "abc", lastStatus: "Unknown", retryCount: 0 } } }),
      "utf-8",
    );

    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(store.listRounds(), []);
    const backups = fs.readdirSync(process.cwd()).filter(
      (file) => file.startsWith(".test-keeper-store.json.corrupted."),
    );
    assert.strictEqual(backups.length, 1);
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
