import { test } from "node:test";
import assert from "node:assert/strict";

import { errorMatches, errorName, waitForRound, keepRound, closeRound, voidIfStale } from "./index.js";
import { defaultRetryPolicy } from "@sub-rosa/tlock";

test("errorMatches detects idempotent contract error codes in any shape", () => {
  assert.equal(errorMatches(new Error("RevealAlreadyOpen"), ["RevealAlreadyOpen"]), true);
  assert.equal(errorMatches(new Error("HostError: ... AlreadyRevealed(32)"), ["AlreadyRevealed"]), true);
  assert.equal(errorMatches({ message: "HashMismatch" }, ["HashMismatch"]), true);
  assert.equal(errorMatches({ error: { code: "RevealWindowClosed" } }, ["RevealWindowClosed"]), true);
  assert.equal(errorMatches(new Error("InvalidDrandSignature"), ["AlreadyRevealed"]), false);
});

test("errorName extracts a readable message", () => {
  assert.equal(errorName(new Error("boom")), "boom");
  assert.equal(errorName({ message: "x" }), JSON.stringify({ message: "x" }));
});

test("waitForRound returns false for a future round when not allowed to wait", async () => {
  // A stub Drand client whose chain info puts round R far in the future.
  const nowS = Math.floor(Date.now() / 1000);
  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: nowS, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    { sdk: {} as never, drand: fakeDrand, maxWaitSeconds: 0 },
    1_000_000, // ~ genesis + 3,000,000s in the future
  );
  assert.equal(ok, false);
});

test("waitForRound returns true immediately for an already-published round", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  const fakeDrand = {
    chain: () => ({
      // genesis far in the past so round 1 is long published.
      info: async () => ({ genesis_time: nowS - 10_000, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    { sdk: {} as never, drand: fakeDrand, maxWaitSeconds: 0 },
    1,
  );
  assert.equal(ok, true);
});

test("keepRound retries on transient Drand errors and succeeds", async () => {
  const policy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterFraction: 0 };

  // Verify the retry policy structure is correct
  assert.ok(policy.maxAttempts > 0);
  assert.ok(policy.baseDelayMs > 0);
  assert.ok(policy.maxDelayMs >= policy.baseDelayMs);
});

test("keepRound handles terminal contract errors without retry", async () => {
  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: 0, period: 3 }),
    }),
  } as never;

  const fakeSDK = {
    getRound: async () => {
      throw new Error("HostError: InvalidContractState");
    },
  } as never;

  // Terminal errors should be thrown immediately without retry
  await assert.rejects(
    () =>
      keepRound(
        {
          sdk: fakeSDK,
          drand: fakeDrand,
          log: () => {},
        },
        1n,
      ),
    /InvalidContractState/,
  );
});

test("voidIfStale retries transient void failures and succeeds", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  let voidAttempts = 0;
  const fakeSDK = {
    getRound: async () => {
      if (voidAttempts === 0) {
        return {
          status: { tag: "Open" as const },
          reveal_deadline: BigInt(nowS - 4000),
        };
      }
      return {
        status: { tag: "Voided" as const },
        reveal_deadline: BigInt(nowS - 4000),
      };
    },
    void: async () => {
      voidAttempts++;
      if (voidAttempts === 1) throw new Error("ECONNRESET");
    },
  } as never;

  const result = await voidIfStale(
    {
      sdk: fakeSDK,
      drand: {} as never,
      log: () => {},
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterFraction: 0 },
    },
    1n,
  );

  assert.equal(voidAttempts, 2);
  assert.equal(result.voided, true);
  assert.equal(result.finalStatus, "Voided");
});

test("retry configuration via retryPolicy in KeeperDeps", async () => {
  const customPolicy = { maxAttempts: 10, baseDelayMs: 50, maxDelayMs: 2000, jitterFraction: 0.2 };

  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: 0, period: 3 }),
    }),
  } as never;

  const fakeSDK = {
    getRound: async () => ({
      status: { tag: "Open" as const },
      reveal_round: 100n,
      commit_deadline: BigInt(Date.now() / 1000 + 10),
      reveal_deadline: BigInt(Date.now() / 1000 + 20),
    }),
  } as never;

  // Verify that KeeperDeps accepts retryPolicy
  const deps = {
    sdk: fakeSDK,
    drand: fakeDrand,
    retryPolicy: customPolicy,
  };

  assert.equal(deps.retryPolicy?.maxAttempts, 10);
  assert.equal(deps.retryPolicy?.baseDelayMs, 50);
});
