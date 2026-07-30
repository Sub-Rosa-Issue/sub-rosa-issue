import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCountdown, formatCountdown } from "./useDrandCountdown";

// Fixed Drand network parameters matching the quicknet defaults.
const GENESIS = 1_692_803_367;
const PERIOD = 3;

// Target round used across boundary tests.
const TARGET_ROUND = 1_000_000;
// targetTime = genesis + period * round
const TARGET_TIME = GENESIS + PERIOD * TARGET_ROUND; // 1695803367

// ---------------------------------------------------------------------------
// computeCountdown
// ---------------------------------------------------------------------------

test("computeCountdown: one second before R reports not published with 1s remaining", () => {
  const result = computeCountdown(
    TARGET_ROUND,
    TARGET_TIME - 1, // nowSecs
    GENESIS,
    PERIOD,
  );

  assert.equal(result.published, false);
  assert.equal(result.targetTime, TARGET_TIME);
  assert.equal(result.secondsRemaining, 1);
  assert.equal(result.currentRound, TARGET_ROUND - 1);
});

test("computeCountdown: exactly at R reports published with 0s remaining", () => {
  const result = computeCountdown(
    TARGET_ROUND,
    TARGET_TIME, // nowSecs
    GENESIS,
    PERIOD,
  );

  assert.equal(result.published, true);
  assert.equal(result.targetTime, TARGET_TIME);
  assert.equal(result.secondsRemaining, 0);
  assert.equal(result.currentRound, TARGET_ROUND);
});

test("computeCountdown: after R reports published with 0s remaining", () => {
  const result = computeCountdown(
    TARGET_ROUND,
    TARGET_TIME + 1, // nowSecs
    GENESIS,
    PERIOD,
  );

  assert.equal(result.published, true);
  assert.equal(result.targetTime, TARGET_TIME);
  assert.equal(result.secondsRemaining, 0);
  // currentRound is still the target round until the next period boundary
  assert.equal(result.currentRound, TARGET_ROUND);
});

test("computeCountdown: published round (well in the past) reports secondsRemaining 0", () => {
  const result = computeCountdown(
    TARGET_ROUND,
    TARGET_TIME + 900_000, // far in the future relative to R
    GENESIS,
    PERIOD,
  );

  assert.equal(result.published, true);
  assert.equal(result.secondsRemaining, 0);
});

test("computeCountdown: future round reports correct targetTime and remaining seconds", () => {
  const result = computeCountdown(
    TARGET_ROUND + 5,
    TARGET_TIME, // nowSecs pinned at TARGET_ROUND
    GENESIS,
    PERIOD,
  );

  const expectedTarget = GENESIS + PERIOD * (TARGET_ROUND + 5);

  assert.equal(result.published, false);
  assert.equal(result.targetTime, expectedTarget);
  assert.equal(result.secondsRemaining, PERIOD * 5);
  assert.equal(result.currentRound, TARGET_ROUND);
});

test("computeCountdown: round zero with genesis at epoch 0", () => {
  const result = computeCountdown(0, 0, 0, 3);

  assert.equal(result.currentRound, 0);
  assert.equal(result.targetTime, 0);
  assert.equal(result.published, true);
  assert.equal(result.secondsRemaining, 0);
});

test("computeCountdown: large target round computes correctly", () => {
  const round = 100_000_000;
  const expectedTarget = GENESIS + PERIOD * round;

  const result = computeCountdown(round, expectedTarget - 1, GENESIS, PERIOD);

  assert.equal(result.published, false);
  assert.equal(result.targetTime, expectedTarget);
  assert.equal(result.secondsRemaining, 1);
  assert.equal(result.currentRound, round - 1);
});

// ---------------------------------------------------------------------------
// formatCountdown
// ---------------------------------------------------------------------------

test("formatCountdown: zero seconds returns 'published'", () => {
  assert.equal(formatCountdown(0), "published");
});

test("formatCountdown: negative seconds returns 'published'", () => {
  assert.equal(formatCountdown(-1), "published");
  assert.equal(formatCountdown(-100), "published");
});

test("formatCountdown: single digit seconds", () => {
  assert.equal(formatCountdown(1), "1s");
  assert.equal(formatCountdown(9), "9s");
});

test("formatCountdown: double digit seconds, no minutes", () => {
  assert.equal(formatCountdown(10), "10s");
  assert.equal(formatCountdown(59), "59s");
});

test("formatCountdown: exactly one minute", () => {
  assert.equal(formatCountdown(60), "1m 0s");
});

test("formatCountdown: minutes with seconds", () => {
  assert.equal(formatCountdown(61), "1m 1s");
  assert.equal(formatCountdown(119), "1m 59s");
  assert.equal(formatCountdown(120), "2m 0s");
  assert.equal(formatCountdown(3599), "59m 59s");
});

test("formatCountdown: exactly one hour", () => {
  assert.equal(formatCountdown(3600), "1h 0m 0s");
});

test("formatCountdown: hours with minutes and seconds", () => {
  assert.equal(formatCountdown(3661), "1h 1m 1s");
  assert.equal(formatCountdown(7200), "2h 0m 0s");
  assert.equal(formatCountdown(7323), "2h 2m 3s");
});

test("formatCountdown: large hour values", () => {
  const seconds = 24 * 3600 + 30 * 60 + 45; // 24h 30m 45s
  assert.equal(formatCountdown(seconds), "24h 30m 45s");
});
