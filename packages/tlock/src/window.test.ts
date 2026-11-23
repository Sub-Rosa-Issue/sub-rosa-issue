// Copyright (c) 2026 Sub Rosa contributors
// SPDX-License-Identifier: MIT
//
// Test vectors for the seal-round commit window (issue #376).
//
// These vectors use the quicknet chain parameters already committed in the
// repo (genesis_time 1692803367, period 3, quicknet chain hash) so the
// TypeScript helper and the Soroban contract can be validated against the
// exact same fixture set. The contract side runs the same cases in
// `contracts/round/src/error_paths.rs` (error_path_seal_round_too_early,
// error_path_seal_round_too_late, error_path_invalid_seal_round_zero) against
// the real quicknet BLS fixture in `contracts/round/src/test.rs`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertSealRoundWindow,
  isMalformedRound,
  SealRoundError,
} from "./window.js";

// Frozen quicknet chain parameters (same fixture as quicknet.test.ts and the
// contract's VEC_GENESIS / VEC_PERIOD / QUICKNET_HASH).
const QUICKNET_FIXTURE = {
  genesis_time: 1_692_803_367,
  period: 3,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
} as const;

test("window vectors share the frozen quicknet chain parameters", () => {
  assert.equal(QUICKNET_FIXTURE.period, 3);
  assert.match(QUICKNET_FIXTURE.hash, /^[0-9a-f]{64}$/);
});

test("a seal exactly at the auction's round is inside the window", () => {
  const revealRound = 10_000_000;
  assert.doesNotThrow(() => assertSealRoundWindow(revealRound, revealRound));
});

test("one round before the auction's round is too early (stable reason)", () => {
  const revealRound = 10_000_000;
  assert.throws(
    () => assertSealRoundWindow(revealRound - 1, revealRound),
    (err: unknown) =>
      err instanceof SealRoundError &&
      err.reason === "seal-round-too-early" &&
      err.sealRound === revealRound - 1 &&
      err.revealRound === revealRound,
  );
});

test("one round after the auction's round is too late (stable reason)", () => {
  const revealRound = 10_000_000;
  assert.throws(
    () => assertSealRoundWindow(revealRound + 1, revealRound),
    (err: unknown) =>
      err instanceof SealRoundError && err.reason === "seal-round-too-late",
  );
});

test("zero, negative, fractional, NaN, and unsafe rounds are malformed", () => {
  for (const round of [0, -1, -100, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isMalformedRound(round), true, `round ${round} must be malformed`);
    assert.throws(
      () => assertSealRoundWindow(round, 10_000_000),
      (err: unknown) =>
        err instanceof SealRoundError && err.reason === "invalid-seal-round-zero",
      `round ${round} must fail before any escrow lock`,
    );
  }
});

test("a malformed auction round is also rejected", () => {
  for (const revealRound of [0, -1, NaN, 2.5]) {
    assert.throws(
      () => assertSealRoundWindow(10_000_000, revealRound),
      (err: unknown) =>
        err instanceof SealRoundError && err.reason === "invalid-seal-round-zero",
    );
  }
});

test("window error messages name the auction's round for integrators", () => {
  try {
    assertSealRoundWindow(9_999_999, 10_000_000);
    assert.fail("expected SealRoundError");
  } catch (err) {
    assert.ok(err instanceof SealRoundError);
    assert.match(err.message, /10_000_000|10000000/);
  }
});

test("round publish time from the fixture stays representable (sanity)", () => {
  // genesis + period × R must fit in a JS-safe integer for realistic rounds;
  // the contract enforces the same shape via checked_time_of_round in u64.
  const round = 100_000_000;
  const publishAtSeconds = QUICKNET_FIXTURE.genesis_time + QUICKNET_FIXTURE.period * round;
  assert.ok(Number.isSafeInteger(publishAtSeconds));
  assert.ok(Number.isSafeInteger(publishAtSeconds * 1000));
});
