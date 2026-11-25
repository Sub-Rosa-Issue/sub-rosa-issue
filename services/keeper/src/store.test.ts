// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { FakeClock } from "@sub-rosa/time";
import {
  compareRoundIds,
  generateLeaseOwner,
  KeeperStore,
  normalizeRoundId,
  parseLeaseMs,
} from "./store.js";

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

  it("drops a single malformed round entry on load and keeps the valid ones", () => {
    cleanUp();
    fs.writeFileSync(
      TEST_STORE_PATH,
      JSON.stringify({
        rounds: {
          "7": { roundId: "7", lastStatus: "Open", retryCount: 0 },
          invalid: { roundId: "abc", lastStatus: "Unknown", retryCount: 0 },
        },
      }),
      "utf-8",
    );

    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(
      store.listRounds().map((round) => round.roundId),
      ["7"],
    );
    // No full-file corrupted backup should be created for a single bad entry
    const backups = fs.readdirSync(process.cwd()).filter(
      (file) => file.startsWith(".test-keeper-store.json.corrupted."),
    );
    assert.strictEqual(backups.length, 0);
    cleanUp();
  });

  it("drops entries whose key is non-numeric and has no valid roundId", () => {
    cleanUp();
    fs.writeFileSync(
      TEST_STORE_PATH,
      JSON.stringify({
        rounds: {
          notanumber: { lastStatus: "Open", retryCount: 0 },
          "12": { roundId: "12", lastStatus: "Open", retryCount: 0 },
        },
      }),
      "utf-8",
    );

    const store = new KeeperStore(TEST_STORE_PATH);
    assert.deepEqual(
      store.listRounds().map((round) => round.roundId),
      ["12"],
    );
    cleanUp();
  });

  it("orders rounds numerically via the shared comparator regardless of id type", () => {
    assert.strictEqual(compareRoundIds(2n, "10"), -1);
    assert.strictEqual(compareRoundIds("10", 2), 1);
    assert.strictEqual(compareRoundIds("7", "07"), 0);
    assert.strictEqual(compareRoundIds(10, "10"), 0);
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

it("captures store diagnostics through an injected logger", () => {
  const temporary = fs.mkdtempSync(path.join(process.cwd(), ".logger-store-"));
  const storePath = path.join(temporary, "store.json");
  const captured: unknown[] = [];
  const logger = {
    debug: () => {}, info: () => {}, error: (...args: unknown[]) => captured.push(args),
    warn: (...args: unknown[]) => captured.push(args),
  };
  try {
    fs.writeFileSync(storePath, JSON.stringify({ rounds: { broken: null } }));
    const store = new KeeperStore(storePath, logger);
    assert.deepEqual(store.listRounds(), []);
    assert.strictEqual(captured.length, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

describe("KeeperStore round leases", () => {
  const TEST_STORE_PATH = path.join(process.cwd(), ".test-keeper-lease-store.json");
  const SCOPE = {
    contractId: "CLEASE",
    network: "Test SDF Network ; September 2015",
  };
  const START_MS = 1_700_000_000_000;

  function cleanUp() {
    if (fs.existsSync(TEST_STORE_PATH)) {
      fs.unlinkSync(TEST_STORE_PATH);
    }
    for (const file of fs.readdirSync(process.cwd())) {
      if (file.startsWith(".test-keeper-lease-store.json.corrupted.")) {
        fs.unlinkSync(path.join(process.cwd(), file));
      }
    }
  }

  it("persists owner, round id, network, contract id and expiry with the claimed round", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(7n, SCOPE);

    const claim = store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 30_000 });
    assert.equal(claim.claimed, true);
    assert.equal(claim.lease.expiresAtMs, START_MS + 30_000);

    // A second process only sees what is on disk.
    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const lease = reloaded.getLease(7n, SCOPE);
    assert.ok(lease, "lease must survive a restart");
    assert.equal(lease.owner, "worker-a");
    assert.equal(lease.roundId, "7");
    assert.equal(lease.network, SCOPE.network);
    assert.equal(lease.contractId, SCOPE.contractId);
    assert.equal(lease.expiresAtMs, START_MS + 30_000);
    assert.equal(reloaded.listLeases().length, 1);
    cleanUp();
  });

  it("refuses a claim while another owner holds a live lease for the round", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const workerA = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const workerB = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    workerA.addRound(7n, SCOPE);

    assert.equal(workerA.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 60_000 }).claimed, true);

    const refused = workerB.claimRound(7n, { ...SCOPE, owner: "worker-b", leaseMs: 60_000 });
    assert.equal(refused.claimed, false, "the second worker must not take the round");
    assert.equal(refused.lease.owner, "worker-a");
    assert.equal(refused.lease.roundId, "7");

    // The refusal must not clobber the live lease.
    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(reloaded.getLease(7n, SCOPE)?.owner, "worker-a");
    cleanUp();
  });

  it("does not block a claim from a different contract id", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(7n, SCOPE);

    assert.equal(
      store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 60_000 }).claimed,
      true,
    );
    const otherContract = store.claimRound(7n, {
      contractId: "COTHER",
      network: SCOPE.network,
      owner: "worker-b",
      leaseMs: 60_000,
    });
    assert.equal(otherContract.claimed, true, "round 7 of another contract is free");
    assert.equal(otherContract.lease.contractId, "COTHER");

    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(reloaded.getLease(7n, { contractId: "CLEASE", network: SCOPE.network })?.owner, "worker-a");
    assert.equal(reloaded.getLease(7n, { contractId: "COTHER", network: SCOPE.network })?.owner, "worker-b");
    assert.equal(reloaded.listLeases().length, 2);
    cleanUp();
  });

  it("lets one more owner claim again once the lease expires (fake clock)", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const crashed = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const next = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const later = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    crashed.addRound(7n, SCOPE);

    assert.equal(crashed.claimRound(7n, { ...SCOPE, owner: "crashed-owner", leaseMs: 60_000 }).claimed, true);
    assert.equal(next.claimRound(7n, { ...SCOPE, owner: "worker-b", leaseMs: 60_000 }).claimed, false);

    clock.advance(60_000);
    const reclaimed = next.claimRound(7n, { ...SCOPE, owner: "worker-b", leaseMs: 60_000 });
    assert.equal(reclaimed.claimed, true, "an expired lease must not lock the round forever");
    assert.equal(reclaimed.lease.owner, "worker-b");
    assert.equal(reclaimed.lease.expiresAtMs, START_MS + 120_000);

    // The reclaimed lease blocks everybody else until it, too, expires.
    assert.equal(later.claimRound(7n, { ...SCOPE, owner: "worker-c", leaseMs: 60_000 }).claimed, false);
    cleanUp();
  });

  it("renews the lease when the same owner claims again", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(7n, SCOPE);

    assert.equal(store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 30_000 }).claimed, true);
    clock.advance(10_000);
    const renewed = store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 30_000 });
    assert.equal(renewed.claimed, true);
    assert.equal(renewed.lease.expiresAtMs, START_MS + 40_000);
    assert.equal(store.listLeases().length, 1, "renewal replaces, never duplicates");
    cleanUp();
  });

  it("releases only the owner's lease", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const workerA = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const workerB = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    workerA.addRound(7n, SCOPE);
    workerA.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 60_000 });

    assert.equal(workerB.releaseLease(7n, { ...SCOPE, owner: "worker-b" }), false);
    assert.equal(workerA.getLease(7n, SCOPE)?.owner, "worker-a", "foreign release must not drop the lease");

    assert.equal(workerA.releaseLease(7n, { ...SCOPE, owner: "worker-a" }), true);
    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(reloaded.getLease(7n, SCOPE), undefined);
    assert.equal(
      reloaded.claimRound(7n, { ...SCOPE, owner: "worker-b", leaseMs: 60_000 }).claimed,
      true,
      "a released round is claimable immediately",
    );
    cleanUp();
  });

  it("rejects an empty owner and a non-positive lease duration", () => {
    cleanUp();
    const clock = new FakeClock(START_MS);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(7n, SCOPE);

    assert.throws(() => store.claimRound(7n, { ...SCOPE, owner: "  " }), /lease owner/);
    assert.throws(() => store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: 0 }), /leaseMs/);
    assert.throws(() => store.claimRound(7n, { ...SCOPE, owner: "worker-a", leaseMs: Number.NaN }), /leaseMs/);
    assert.throws(() => store.releaseLease(7n, { ...SCOPE, owner: "" }), /lease owner/);
    assert.equal(store.listLeases().length, 0, "a rejected claim leaves no lease behind");
    cleanUp();
  });

  it("parses KEEPER_LEASE_MS and generates a fresh owner id per run", () => {
    assert.equal(parseLeaseMs(undefined), undefined);
    assert.equal(parseLeaseMs("  "), undefined);
    assert.equal(parseLeaseMs("2500"), 2500);
    assert.throws(() => parseLeaseMs("0"), /KEEPER_LEASE_MS/);
    assert.throws(() => parseLeaseMs("soon"), /KEEPER_LEASE_MS/);

    const first = generateLeaseOwner();
    assert.ok(first.startsWith(`keeper-${process.pid}-`));
    assert.notEqual(first, generateLeaseOwner());
  });

  it("drops malformed stored leases and keeps the valid one", () => {
    cleanUp();
    fs.writeFileSync(
      TEST_STORE_PATH,
      JSON.stringify({
        rounds: { "7": { roundId: "7", lastStatus: "Open", retryCount: 0 } },
        leases: {
          "CLEASE|net|7": {
            owner: "worker-a",
            roundId: "7",
            contractId: "CLEASE",
            network: "net",
            expiresAtMs: START_MS + 60_000,
          },
          "bad-null": null,
          "no-owner": { roundId: "8", expiresAtMs: START_MS },
          "no-expiry": { owner: "worker-b", roundId: "9" },
          "bad-round": { owner: "worker-c", roundId: "abc", expiresAtMs: START_MS },
        },
      }),
      "utf-8",
    );

    const store = new KeeperStore(TEST_STORE_PATH, undefined, new FakeClock(START_MS));
    const leases = store.listLeases();
    assert.equal(leases.length, 1);
    assert.equal(leases[0].owner, "worker-a");
    assert.equal(leases[0].roundId, "7");
    cleanUp();
  });
});
