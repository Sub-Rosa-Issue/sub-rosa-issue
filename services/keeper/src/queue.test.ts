import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  addRound,
  listRounds,
  loadQueue,
  pruneCompleted,
  removeRound,
  saveQueue,
  updateRound,
  QUEUE_VERSION,
  type WatchedRound,
} from "./queue.js";

const CONTRACT_A = "CCONTRACT_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CONTRACT_B = "CCONTRACT_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NETWORK = "Test SDF Network ; September 2015";

let tmpDir: string;

function storePath(name = "queue.json"): string {
  return join(tmpDir, name);
}

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keeper-queue-test-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadQueue", () => {
  test("returns empty queue when file does not exist", () => {
    const q = loadQueue(storePath("missing.json"));
    assert.equal(q.version, QUEUE_VERSION);
    assert.deepEqual(q.rounds, []);
  });

  test("returns empty queue for corrupted JSON", () => {
    const p = storePath("corrupt.json");
    writeFileSync(p, "{ not valid json {{");
    const q = loadQueue(p);
    assert.deepEqual(q.rounds, []);
  });

  test("returns empty queue when structure is unexpected", () => {
    const p = storePath("bad-structure.json");
    writeFileSync(p, JSON.stringify({ version: 1, data: [] }));
    const q = loadQueue(p);
    assert.deepEqual(q.rounds, []);
  });

  test("returns empty queue when rounds field is missing", () => {
    const p = storePath("no-rounds.json");
    writeFileSync(p, JSON.stringify({ version: 1 }));
    const q = loadQueue(p);
    assert.deepEqual(q.rounds, []);
  });

  test("loads a valid queue correctly", () => {
    const p = storePath("valid.json");
    const entry: WatchedRound = {
      roundId: "1",
      contractId: CONTRACT_A,
      network: NETWORK,
      revealRound: "100",
      lastStatus: "Open",
      retryCount: 0,
      lastRetryAt: null,
      lastAction: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    saveQueue(p, { version: QUEUE_VERSION, rounds: [entry] });
    const q = loadQueue(p);
    assert.equal(q.rounds.length, 1);
    assert.equal(q.rounds[0]!.roundId, "1");
  });
});

describe("saveQueue / atomicity", () => {
  test("writes valid JSON that can be re-read", () => {
    const p = storePath("save-test.json");
    const queue = {
      version: QUEUE_VERSION,
      rounds: [] as WatchedRound[],
    };
    saveQueue(p, queue);
    const raw = readFileSync(p, "utf-8");
    assert.doesNotThrow(() => JSON.parse(raw));
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, QUEUE_VERSION);
    assert.deepEqual(parsed.rounds, []);
  });

  test("does not leave a .tmp file behind", () => {
    const p = storePath("no-tmp-leak.json");
    saveQueue(p, { version: QUEUE_VERSION, rounds: [] });
    const files = readdirSync(tmpDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp."));
    assert.equal(tmpFiles.length, 0);
  });
});

describe("addRound", () => {
  test("adds a new round and persists it", () => {
    const p = storePath("add-round.json");
    const { entry, added } = addRound(p, {
      roundId: 42n,
      contractId: CONTRACT_A,
      network: NETWORK,
    });
    assert.equal(added, true);
    assert.equal(entry.roundId, "42");
    assert.equal(entry.contractId, CONTRACT_A);
    assert.equal(entry.lastStatus, "unknown");
    assert.equal(entry.revealRound, "unknown");
    assert.equal(entry.retryCount, 0);
    assert.equal(entry.lastRetryAt, null);
    assert.equal(entry.lastAction, null);

    const q = loadQueue(p);
    assert.equal(q.rounds.length, 1);
    assert.equal(q.rounds[0]!.roundId, "42");
  });

  test("stores revealRound when provided", () => {
    const p = storePath("add-with-reveal.json");
    const { entry } = addRound(p, {
      roundId: 7n,
      contractId: CONTRACT_A,
      network: NETWORK,
      revealRound: 1234n,
    });
    assert.equal(entry.revealRound, "1234");
  });

  test("prevents duplicate registration — same roundId+contractId", () => {
    const p = storePath("no-dup.json");
    const first = addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    const second = addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    assert.equal(first.added, true);
    assert.equal(second.added, false);
    assert.equal(second.entry.createdAt, first.entry.createdAt);
    const q = loadQueue(p);
    assert.equal(q.rounds.length, 1);
  });

  test("allows same roundId on a different contract", () => {
    const p = storePath("diff-contract.json");
    const r1 = addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    const r2 = addRound(p, { roundId: 1n, contractId: CONTRACT_B, network: NETWORK });
    assert.equal(r1.added, true);
    assert.equal(r2.added, true);
    assert.equal(loadQueue(p).rounds.length, 2);
  });

  test("multiple distinct rounds accumulate", () => {
    const p = storePath("multi-add.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 2n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 3n, contractId: CONTRACT_A, network: NETWORK });
    assert.equal(loadQueue(p).rounds.length, 3);
  });
});

describe("listRounds", () => {
  test("returns empty array for empty store", () => {
    assert.deepEqual(listRounds(storePath("list-empty.json")), []);
  });

  test("returns all entries", () => {
    const p = storePath("list-all.json");
    addRound(p, { roundId: 10n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 20n, contractId: CONTRACT_A, network: NETWORK });
    const rounds = listRounds(p);
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0]!.roundId, "10");
    assert.equal(rounds[1]!.roundId, "20");
  });
});

describe("removeRound", () => {
  test("removes an existing round and returns true", () => {
    const p = storePath("remove-found.json");
    addRound(p, { roundId: 5n, contractId: CONTRACT_A, network: NETWORK });
    const removed = removeRound(p, 5n, CONTRACT_A);
    assert.equal(removed, true);
    assert.equal(loadQueue(p).rounds.length, 0);
  });

  test("returns false when round not found", () => {
    const p = storePath("remove-missing.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    const removed = removeRound(p, 99n, CONTRACT_A);
    assert.equal(removed, false);
    assert.equal(loadQueue(p).rounds.length, 1);
  });

  test("only removes the matching round, leaves others intact", () => {
    const p = storePath("remove-selective.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 2n, contractId: CONTRACT_A, network: NETWORK });
    removeRound(p, 1n, CONTRACT_A);
    const rounds = loadQueue(p).rounds;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]!.roundId, "2");
  });

  test("does not remove when contractId differs", () => {
    const p = storePath("remove-wrong-contract.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    const removed = removeRound(p, 1n, CONTRACT_B);
    assert.equal(removed, false);
    assert.equal(loadQueue(p).rounds.length, 1);
  });
});

describe("updateRound", () => {
  test("patches a found entry and returns true", () => {
    const p = storePath("update-found.json");
    addRound(p, { roundId: 3n, contractId: CONTRACT_A, network: NETWORK });
    const updated = updateRound(p, 3n, CONTRACT_A, {
      lastStatus: "Revealing",
      lastAction: "open",
      retryCount: 1,
    });
    assert.equal(updated, true);
    const entry = loadQueue(p).rounds[0]!;
    assert.equal(entry.lastStatus, "Revealing");
    assert.equal(entry.lastAction, "open");
    assert.equal(entry.retryCount, 1);
    assert.notEqual(entry.updatedAt, entry.createdAt);
  });

  test("returns false when round not found", () => {
    const p = storePath("update-missing.json");
    const updated = updateRound(p, 99n, CONTRACT_A, { lastStatus: "Settled" });
    assert.equal(updated, false);
  });

  test("does not modify other entries", () => {
    const p = storePath("update-isolation.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 2n, contractId: CONTRACT_A, network: NETWORK });
    updateRound(p, 1n, CONTRACT_A, { lastStatus: "Settled" });
    const rounds = loadQueue(p).rounds;
    assert.equal(rounds[0]!.lastStatus, "Settled");
    assert.equal(rounds[1]!.lastStatus, "unknown");
  });
});

describe("pruneCompleted", () => {
  test("removes Settled and Voided rounds", () => {
    const p = storePath("prune-completed.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 2n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 3n, contractId: CONTRACT_A, network: NETWORK });
    updateRound(p, 1n, CONTRACT_A, { lastStatus: "Settled" });
    updateRound(p, 2n, CONTRACT_A, { lastStatus: "Voided" });

    const removed = pruneCompleted(p);
    assert.equal(removed, 2);
    const rounds = loadQueue(p).rounds;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]!.roundId, "3");
  });

  test("returns 0 and does not write when nothing to prune", () => {
    const p = storePath("prune-nothing.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    updateRound(p, 1n, CONTRACT_A, { lastStatus: "Open" });
    const before = readFileSync(p, "utf-8");
    const removed = pruneCompleted(p);
    assert.equal(removed, 0);
    assert.equal(readFileSync(p, "utf-8"), before);
  });

  test("handles empty store gracefully", () => {
    const removed = pruneCompleted(storePath("prune-empty.json"));
    assert.equal(removed, 0);
  });

  test("retains active rounds with unknown status", () => {
    const p = storePath("prune-unknown.json");
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    const removed = pruneCompleted(p);
    assert.equal(removed, 0);
    assert.equal(loadQueue(p).rounds.length, 1);
  });
});

describe("resume behavior", () => {
  test("queue entries persist across separate load calls (simulated restart)", () => {
    const p = storePath("resume.json");

    // First process run: add rounds
    addRound(p, { roundId: 1n, contractId: CONTRACT_A, network: NETWORK });
    addRound(p, { roundId: 2n, contractId: CONTRACT_A, network: NETWORK });
    updateRound(p, 1n, CONTRACT_A, { lastStatus: "Revealing" });

    // Simulate restart: re-read store from scratch
    const resumed = loadQueue(p);
    assert.equal(resumed.rounds.length, 2);
    const r1 = resumed.rounds.find((r) => r.roundId === "1")!;
    assert.equal(r1.lastStatus, "Revealing");
    const r2 = resumed.rounds.find((r) => r.roundId === "2")!;
    assert.equal(r2.lastStatus, "unknown");
  });

  test("large number of rounds round-trips correctly", () => {
    const p = storePath("large-store.json");
    for (let i = 1n; i <= 100n; i++) {
      addRound(p, { roundId: i, contractId: CONTRACT_A, network: NETWORK });
    }
    const q = loadQueue(p);
    assert.equal(q.rounds.length, 100);
    assert.equal(q.rounds[0]!.roundId, "1");
    assert.equal(q.rounds[99]!.roundId, "100");
  });
});
