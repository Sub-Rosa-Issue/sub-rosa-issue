import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildKeeperStatus,
  buildRoundStatus,
  checkHealth,
  type BuildStatusSource,
} from "./status.js";
import type { WatchedRound } from "./store.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

// Complete BidState placeholder with neutral status fields.
function bidState(revealedValue: bigint | null) {
  return {
    commitment: Buffer.from("00"),
    escrow: 0n,
    revealed_nonce: undefined,
    revealed_value: revealedValue === null ? undefined : revealedValue,
    settled: false,
    valid: false,
  } as import("@sub-rosa/sdk").BidState;
}

function drandOk(genesisTime = 1_000, period = 3, signatureReady = false) {
  return {
    chain: () => ({
      info: async () => ({ genesis_time: genesisTime, period }),
    }),
    // drand-client uses chain().info() for info but client.get(round) for beacons.
    get: async (_round: number) => {
      if (!signatureReady) throw new Error("round not published yet");
      return { round: _round, signature: "0x" + "00".repeat(96) };
    },
  } as never;
}

function drandDown() {
  return {
    chain: () => ({
      info: async () => {
        throw new Error("drand unreachable");
      },
    }),
  } as never;
}

function baseRound(
  overrides: Record<string, unknown> & { status?: string },
) {
  const clearingRuleTag =
    (overrides.clearingRule as "HighestBid" | "LowestBid" | undefined) ??
    "HighestBid";
  return {
    status: {
      tag: (overrides.status as string | undefined) ?? "Open",
    } as import("@sub-rosa/sdk").Status,
    reveal_round: BigInt(
      (overrides.revealRound as number | bigint | undefined) ?? 100,
    ),
    commit_deadline: BigInt(
      (overrides.commitDeadline as number | bigint | undefined) ??
        Math.floor(Date.now() / 1000) + 3600,
    ),
    reveal_deadline: BigInt(
      (overrides.revealDeadline as number | bigint | undefined) ??
        Math.floor(Date.now() / 1000) + 7200,
    ),
    bidders: (overrides.bidders ?? []) as string[],
    winner: (overrides.winner ?? null) as string | null,
    winning_bid: BigInt(
      (overrides.winningBid as number | bigint | undefined) ?? 0,
    ),
    clearing_rule: { tag: clearingRuleTag } as import("@sub-rosa/sdk").ClearingRule,
    auditor_pubkey: Buffer.from("aa"),
    item_ref: Buffer.from("bb".repeat(32), "hex"),
    operator: "GOPERATOR",
  } as import("@sub-rosa/sdk").Round;
}

function readerOk(
  overrides: Record<string, unknown> & { status?: string } = {},
): import("./status.js").StatusReader {
  const state = baseRound(overrides);
  const bidStates = (overrides.bidStates ?? []) as Array<{
    revealed_value: bigint | null;
  }>;
  let stateIdx = 0;
  return {
    getRound: async () => state,
    getBidState: async () => {
      const next = bidStates[stateIdx++];
      return bidState(next?.revealed_value ?? null);
    },
  };
}

function readerDown() {
  return {
    getRound: async () => {
      throw new Error("rpc connection refused");
    },
    getBidState: async () => {
      throw new Error("rpc connection refused");
    },
  };
}

function readerNotFound() {
  return {
    getRound: async () => {
      throw new Error("HostError: RoundNotFound(1)");
    },
    getBidState: async () => {
      throw new Error("HostError: RoundNotFound(1)");
    },
  };
}

function makeSource(overrides: Partial<BuildStatusSource> = {}): BuildStatusSource {
  return {
    reader: readerOk(),
    drand: drandOk(),
    storeRounds: () => [],
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB",
    network: "Test SDF Network ; September 2015",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("buildKeeperStatus — empty state", () => {
  it("returns an empty rounds array and ok health when no rounds are tracked", async () => {
    const res = await buildKeeperStatus(makeSource());
    assert.deepEqual(res.rounds, []);
    assert.equal(res.contractId, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB");
    assert.equal(res.network, "Test SDF Network ; September 2015");
    assert.equal(res.health.rpc, "ok");
    assert.equal(res.health.drand, "ok");
    assert.ok(typeof res.uptimeSeconds === "number");
    assert.ok(res.now.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Pending round (Open, R not yet published)
// ---------------------------------------------------------------------------

describe("buildRoundStatus — pending round", () => {
  it("reports awaiting-drand when R is in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Drand genesis far in the future so that R=1_000_000 has not been reached.
    const source = makeSource({
      reader: readerOk({
        status: "Open",
        revealRound: 1_000_000,
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        bidders: ["GAAA", "GBBB"],
      }),
      drand: drandOk(now + 1_000_000, 3),
      nowSeconds: now,
      storeRounds: () => [
        {
          roundId: "1",
          lastStatus: "Open",
          retryCount: 0,
        },
      ] as WatchedRound[],
    });
    const res = await buildKeeperStatus(source);
    assert.equal(res.rounds.length, 1);
    const r = res.rounds[0];
    assert.equal(r.status, "Open");
    assert.equal(r.phase, "awaiting-drand");
    assert.equal(r.revealReady, false);
    assert.equal(r.bidderCount, 2);
    assert.equal(r.commitClosed, false);
    assert.equal(r.revealWindowOpen, false);
    assert.equal(r.settlement, "none");
  });
});

// ---------------------------------------------------------------------------
// Ready-to-open (Open, R published, signature available)
// ---------------------------------------------------------------------------

describe("buildRoundStatus — ready-to-open", () => {
  it("reports revealReady=true when R is published and signature available", async () => {
    const now = Math.floor(Date.now() / 1000);
    const source = makeSource({
      reader: readerOk({
        status: "Open",
        revealRound: 1,
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        bidders: ["GCCC"],
      }),
      drand: drandOk(1_000, 3, true),
      nowSeconds: now,
      storeRounds: () => [
        {
          roundId: "2",
          lastStatus: "Open",
          retryCount: 0,
        },
      ] as WatchedRound[],
    });
    const res = await buildKeeperStatus(source);
    const r = res.rounds[0];
    assert.equal(r.status, "Open");
    assert.equal(r.revealReady, true);
    assert.equal(r.phase, "awaiting-drand");
    assert.equal(r.bidderCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Settled round
// ---------------------------------------------------------------------------

describe("buildRoundStatus — settled round", () => {
  it("reports terminal settlement and complete phase", async () => {
    const now = Math.floor(Date.now() / 1000);
    const source = makeSource({
      reader: readerOk({
        status: "Settled",
        revealRound: 1,
        commitDeadline: now - 7200,
        revealDeadline: now - 3600,
        bidders: ["GDDD"],
        winner: "GDDD",
        winningBid: 100n,
      }),
      storeRounds: () => [
        {
          roundId: "3",
          lastStatus: "Settled",
          retryCount: 0,
          lastAction: "settled",
        },
      ] as WatchedRound[],
    });
    const res = await buildKeeperStatus(source);
    const r = res.rounds[0];
    assert.equal(r.status, "Settled");
    assert.equal(r.phase, "complete");
    assert.equal(r.settlement, "terminal");
    assert.equal(r.winner, "GDDD");
    assert.equal(r.winningValue, "100");
    assert.equal(r.lastKeeperAction, "settled");
  });
});

// ---------------------------------------------------------------------------
// Upstream failure states
// ---------------------------------------------------------------------------

describe("buildKeeperStatus — upstream failure", () => {
  it("marks RPC as down when getRound throws a non-NotFound error", async () => {
    const source = makeSource({ reader: readerDown() });
    const health = await checkHealth(source.reader, source.drand);
    assert.equal(health.rpc, "down");
    assert.match(String(health.reason ?? ""), /rpc/);
  });

  it("marks drand as down when chain info throws", async () => {
    const source = makeSource({ drand: drandDown() });
    const health = await checkHealth(source.reader, source.drand);
    assert.equal(health.drand, "down");
    assert.match(String(health.reason ?? ""), /drand/);
  });

  it("does not crash when a tracked round is missing on-chain", async () => {
    const source = makeSource({
      reader: readerNotFound(),
      storeRounds: () => [
        {
          roundId: "42",
          lastStatus: "Unknown",
          retryCount: 1,
          lastError: "rpc connection refused",
        },
      ] as WatchedRound[],
    });
    const res = await buildKeeperStatus(source);
    assert.equal(res.rounds.length, 1);
    const r = res.rounds[0];
    assert.equal(r.status, "NotFound");
    assert.equal(r.lastError, "rpc connection refused");
    assert.equal(r.retryCount, 1);
  });

  it("does not crash when a tracked round throws a non-NotFound error", async () => {
    const source = makeSource({
      reader: readerDown(),
      storeRounds: () => [
        {
          roundId: "7",
          lastStatus: "Unknown",
          retryCount: 2,
          lastError: "rpc connection refused",
        },
      ] as WatchedRound[],
    });
    const res = await buildKeeperStatus(source);
    assert.equal(res.rounds.length, 1);
    const r = res.rounds[0];
    assert.equal(r.status, "Unknown");
    assert.equal(r.lastError, "rpc connection refused");
    assert.equal(r.retryCount, 2);
  });
});

// ---------------------------------------------------------------------------
// Round sorting: active rounds first, then terminal
// ---------------------------------------------------------------------------

describe("buildKeeperStatus — round ordering", () => {
  it("sorts active rounds before terminal ones", async () => {
    const now = Math.floor(Date.now() / 1000);
    const source = makeSource({
      reader: readerOk({
        status: "Open",
        revealRound: 1_000_000,
        commitDeadline: now + 3600,
        revealDeadline: now + 7200,
        bidders: [],
      }),
      storeRounds: () => [
        { roundId: "10", lastStatus: "Settled", retryCount: 0 } as WatchedRound,
        { roundId: "2", lastStatus: "Open", retryCount: 0 } as WatchedRound,
        { roundId: "9", lastStatus: "Voided", retryCount: 0 } as WatchedRound,
        { roundId: "1", lastStatus: "Open", retryCount: 0 } as WatchedRound,
      ],
    });
    const res = await buildKeeperStatus(source);
    const ids = res.rounds.map((r) => r.roundId);
    // Active first (1, 2), then terminal sorted by id (9, 10)
    assert.deepEqual(ids, ["1", "2", "9", "10"]);
  });
});

// ---------------------------------------------------------------------------
// No secret material leaks
// ---------------------------------------------------------------------------

describe("buildKeeperStatus — no secret material", () => {
  it("does not include any secret-key-shaped fields in the response", async () => {
    const res = await buildKeeperStatus(makeSource());
    const json = JSON.stringify(res);
    assert.doesNotMatch(json, /S[A-Z0-9]{50,}/, "must not contain Stellar secret keys");
    assert.doesNotMatch(json, /secret/i, "must not contain 'secret' substring");
  });
});
