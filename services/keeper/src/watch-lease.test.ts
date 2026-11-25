// Copyright (c) 2026 Sub Rosa contributors
// watch-lease.test.ts
//
// Exclusive round leases across the watch loop and the on-disk store.
//
// Everything here is offline: a fake chain stands in for the SDK, a FakeClock
// stands in for wall time, and no RPC or HTTP server is ever started.

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import type { SubRosaClient } from "@sub-rosa/sdk";
import type { DrandClient } from "@sub-rosa/tlock";
import { FakeClock, FakeScheduler } from "@sub-rosa/time";

import { createSettlementGuard } from "./settlement-guard.js";
import { DEFAULT_LEASE_MS, KeeperStore, type LeaseScope } from "./store.js";
import { isDefinitiveContractFailure, runWatchLoop } from "./watch-loop.js";

const TEST_STORE_PATH = path.join(process.cwd(), ".test-watch-lease-store.json");
const CONTRACT_ID = "CLEASE";
const NETWORK = "Test SDF Network ; September 2015";
const SCOPE: LeaseScope = { contractId: CONTRACT_ID, network: NETWORK };
const START_MS = 1_700_000_000_000;
const LEASE_MS = 60_000;

const previousRoundIds = process.env.WATCH_ROUND_IDS;

before(() => {
  process.env.WATCH_ROUND_IDS = "1";
});

after(() => {
  if (previousRoundIds === undefined) {
    delete process.env.WATCH_ROUND_IDS;
  } else {
    process.env.WATCH_ROUND_IDS = previousRoundIds;
  }
});

function cleanUp() {
  if (fs.existsSync(TEST_STORE_PATH)) {
    fs.unlinkSync(TEST_STORE_PATH);
  }
  for (const file of fs.readdirSync(process.cwd())) {
    if (file.startsWith(".test-watch-lease-store.json.")) {
      fs.unlinkSync(path.join(process.cwd(), file));
    }
  }
}

beforeEach(cleanUp);
afterEach(cleanUp);

/** Chain state every fake SDK for the same round shares. */
interface FakeChain {
  status: string;
  settleAttempts: string[];
}

interface FakeSdkOptions {
  /** Status the chain moves to after a successful settle. */
  settleTo?: string;
  /** Thrown by settle before it records anything else. */
  settleError?: () => Error | undefined;
}

/**
 * A minimal SDK over an in-memory round. It only implements the paths a
 * Cleared round takes through `watchRound`; anything else fails loudly.
 *
 * The round it serves is a fully revealed, cleared auction (two bidders, one
 * winner) so the settlement guard can verify the winner and the refund set
 * exactly the way it does against a real chain.
 */
function createSdk(chain: FakeChain, label: string, options: FakeSdkOptions = {}): SubRosaClient {
  const bidders = ["GAAA", "GBBB"];
  const state: Record<string, { escrow: bigint; revealed_value: bigint }> = {
    GAAA: { escrow: 700n, revealed_value: 700n },
    GBBB: { escrow: 500n, revealed_value: 500n },
  };
  const sdk = {
    async getRound(id: bigint) {
      if (id !== 1n) {
        throw new Error(`HostError: RoundNotFound(${id})`);
      }
      return {
        status: { tag: chain.status },
        reveal_round: "1",
        reveal_deadline: "0",
        commit_deadline: "0",
        bidders,
        winner: "GAAA",
        winning_bid: 700n,
        clearing_rule: { tag: "HighestBid" },
      };
    },
    async getBiddersPage(_id: bigint, _cursor: number, _limit: number) {
      return { data: bidders, next_cursor: 0, total: bidders.length };
    },
    async getBidState(_id: bigint, bidder: string) {
      const s = state[bidder];
      if (!s) throw new Error(`HostError: BidNotFound(${bidder})`);
      return {
        escrow: s.escrow,
        revealed_value: s.revealed_value,
        revealed_nonce: 1n,
        settled: false,
        valid: true,
      };
    },
    async settle(_id: bigint) {
      chain.settleAttempts.push(label);
      const error = options.settleError?.();
      if (error) throw error;
      if (options.settleTo) chain.status = options.settleTo;
    },
    async clear() {
      throw new Error("clear must not run for a Cleared round");
    },
    async void() {
      throw new Error("void must not run for a live round");
    },
    async openReveal() {
      throw new Error("openReveal must not run for a Cleared round");
    },
    async bidders() {
      throw new Error("bidders must not run for a Cleared round");
    },
    async getSeal() {
      return null;
    },
  };
  return sdk as unknown as SubRosaClient;
}

interface WorkerParams {
  owner?: string;
  sdk: SubRosaClient;
  store: KeeperStore;
  clock: FakeClock;
  scheduler: FakeScheduler;
  leaseMs?: number;
  logs?: string[];
}

/**
 * One watcher process: one queue pass, then stop. The claim counter doubles as
 * the stop signal, so every worker gets exactly one chance to claim the round
 * regardless of whether the claim succeeded.
 */
async function runWorker(params: WorkerParams): Promise<void> {
  const attempts = { count: 0 };
  const checks = { count: 0 };
  const claimRound = params.store.claimRound.bind(params.store);
  params.store.claimRound = (roundId, options) => {
    attempts.count++;
    return claimRound(roundId, options);
  };

  await runWatchLoop({
    sdk: params.sdk,
    drand: {} as DrandClient,
    log: (message) => params.logs?.push(message),
    pollMs: 0,
    contractId: CONTRACT_ID,
    network: NETWORK,
    store: params.store,
    settlementGuard: createSettlementGuard(params.clock),
    // Stop after one claim attempt; the upper bound only exists so a broken
    // queue fails the assertions below instead of spinning forever.
    isStopping: () => attempts.count >= 1 || ++checks.count > 200,
    time: { clock: params.clock, scheduler: params.scheduler },
    owner: params.owner,
    ...(params.leaseMs !== undefined ? { leaseMs: params.leaseMs } : {}),
  });
}

function createChain(status = "Cleared"): FakeChain {
  return { status, settleAttempts: [] };
}

describe("watch loop round leases", () => {
  it("two workers claiming the same round produce one submission", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const workerAStore = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    const workerBStore = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    workerAStore.addRound(1n, SCOPE);
    workerBStore.addRound(1n, SCOPE);

    await Promise.all([
      runWorker({
        owner: "worker-a",
        sdk: createSdk(chain, "worker-a"),
        store: workerAStore,
        clock,
        scheduler,
        leaseMs: LEASE_MS,
      }),
      runWorker({
        owner: "worker-b",
        sdk: createSdk(chain, "worker-b"),
        store: workerBStore,
        clock,
        scheduler,
        leaseMs: LEASE_MS,
      }),
    ]);

    assert.deepEqual(
      chain.settleAttempts,
      ["worker-a"],
      "the losing worker must not submit alongside the winner",
    );
    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(
      reloaded.getLease(1n, SCOPE)?.owner,
      chain.settleAttempts[0],
      "the submitting worker still holds the lease",
    );
    assert.equal(reloaded.getRound(1n)?.retryCount, 0, "the skipped worker records no failure");
  });

  it("releases the lease once the step reaches a terminal success", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(1n, SCOPE);

    await runWorker({
      owner: "worker-a",
      sdk: createSdk(chain, "worker-a", { settleTo: "Settled" }),
      store,
      clock,
      scheduler,
    });

    assert.deepEqual(chain.settleAttempts, ["worker-a"]);
    assert.equal(store.getLease(1n, SCOPE), undefined, "a terminal round gives the lease back");
    const reloaded = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(reloaded.getLease(1n, SCOPE), undefined);
    assert.equal(reloaded.getRound(1n)?.lastStatus, "Settled");
  });

  it("keeps the lease on a transient failure and hands the round over once it expires", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(1n, SCOPE);

    await runWorker({
      owner: "worker-a",
      sdk: createSdk(chain, "worker-a", {
        settleError: () => new Error("fetch failed: ETIMEDOUT"),
      }),
      store,
      clock,
      scheduler,
      leaseMs: LEASE_MS,
    });

    assert.deepEqual(chain.settleAttempts, ["worker-a"]);
    const lease = store.getLease(1n, SCOPE);
    assert.ok(lease, "a retryable failure must not release the round");
    assert.equal(lease.owner, "worker-a");
    assert.equal(lease.expiresAtMs, START_MS + LEASE_MS);
    assert.equal(store.getRound(1n)?.retryCount, 1);
    assert.equal(store.getRound(1n)?.lastError, "fetch failed: ETIMEDOUT");

    // While that lease is live, a second watcher stays out of the round.
    await runWorker({
      owner: "worker-b",
      sdk: createSdk(chain, "worker-b"),
      store: new KeeperStore(TEST_STORE_PATH, undefined, clock),
      clock,
      scheduler,
      leaseMs: LEASE_MS,
    });
    assert.deepEqual(chain.settleAttempts, ["worker-a"], "no submission while the lease is live");

    // A crashed owner stops locking the round when the lease expires.
    clock.advance(LEASE_MS);
    const nextOwner = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    await runWorker({
      owner: "worker-b",
      sdk: createSdk(chain, "worker-b"),
      store: nextOwner,
      clock,
      scheduler,
      leaseMs: LEASE_MS,
    });
    assert.deepEqual(chain.settleAttempts, ["worker-a", "worker-b"]);
    assert.equal(nextOwner.getLease(1n, SCOPE)?.owner, "worker-b");
  });

  it("releases the lease after a definitive contract failure", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(1n, SCOPE);

    // keeper.ts swallows idempotent contract skips (AlreadySettled, …) and
    // re-reads the chain, so a definitive failure here is a rejection that
    // cannot succeed on a retry.
    await runWorker({
      owner: "worker-a",
      sdk: createSdk(chain, "worker-a", {
        settleError: () => new Error("HostError: Error(Contract, #11) InsufficientFee"),
      }),
      store,
      clock,
      scheduler,
      leaseMs: LEASE_MS,
    });

    assert.deepEqual(chain.settleAttempts, ["worker-a"]);
    assert.equal(store.getLease(1n, SCOPE), undefined, "a definitive rejection hands the round back");
    assert.equal(store.getRound(1n)?.retryCount, 1);
    assert.match(store.getRound(1n)?.lastError ?? "", /InsufficientFee/);

    // The round is free again for the next watcher.
    const next = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    assert.equal(next.claimRound(1n, { ...SCOPE, owner: "worker-b" }).claimed, true);
  });

  it("skips the round while another owner holds a live lease", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(1n, SCOPE);
    const seeded = store.claimRound(1n, { ...SCOPE, owner: "other-watcher", leaseMs: LEASE_MS });
    assert.equal(seeded.claimed, true);

    await runWorker({
      owner: "worker-a",
      sdk: createSdk(chain, "worker-a"),
      store,
      clock,
      scheduler,
      leaseMs: LEASE_MS,
    });

    assert.deepEqual(chain.settleAttempts, [], "no submission while somebody else owns the round");
    assert.equal(store.getLease(1n, SCOPE)?.owner, "other-watcher");
    assert.equal(store.getRound(1n)?.retryCount, 0, "a blocked tick is not a failure");
  });

  it("generates a lease owner when the loop is not given one", async () => {
    const chain = createChain();
    const clock = new FakeClock(START_MS);
    const scheduler = new FakeScheduler(clock);
    const store = new KeeperStore(TEST_STORE_PATH, undefined, clock);
    store.addRound(1n, SCOPE);

    await runWorker({
      sdk: createSdk(chain, "worker-a"),
      store,
      clock,
      scheduler,
    });

    const lease = store.getLease(1n, SCOPE);
    assert.ok(lease);
    assert.match(lease.owner, new RegExp(`^keeper-${process.pid}-`));
    assert.equal(lease.expiresAtMs, START_MS + DEFAULT_LEASE_MS);
  });
});

describe("isDefinitiveContractFailure", () => {
  it("treats transport failures as retryable, not definitive", () => {
    assert.equal(isDefinitiveContractFailure(new Error("fetch failed: connect ECONNREFUSED")), false);
    assert.equal(isDefinitiveContractFailure(new Error("transaction 123 timed out after 30000ms")), false);
    assert.equal(isDefinitiveContractFailure(new Error("socket hang up")), false);
  });

  it("treats an answer from the contract as definitive", () => {
    assert.equal(isDefinitiveContractFailure(new Error("HostError: Error(Contract, #12) WrongStatus")), true);
    assert.equal(isDefinitiveContractFailure(new Error("HostError: RoundNotFound(9)")), true);
    assert.equal(isDefinitiveContractFailure(new Error("transaction 123 ended with status FAILED")), true);
  });

  it("keeps the lease for failures it cannot classify", () => {
    assert.equal(isDefinitiveContractFailure(new Error("something went wrong")), false);
    assert.equal(isDefinitiveContractFailure("plain string"), false);
  });
});
