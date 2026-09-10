// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";
import { localCountdown, timeOfRound, formatCountdown, QUICKNET_GENESIS } from "./countdown";
import { formatDuration } from "./format";

test("duration boundaries preserve hours, minutes and seconds", () => {
  for (const [input, expected] of [[-1, "0s"], [0, "0s"], [1, "1s"], [59, "59s"], [60, "1m 0s"], [3599, "59m 59s"], [3600, "1h 0m 0s"], [3661, "1h 1m 1s"], [90061, "25h 1m 1s"], [1.5, "1.5s"]] as const) {
    assert.equal(formatDuration(input), expected);
    assert.equal(formatCountdown(input), input <= 0 ? "published" : expected);
  }
});
test("quicknet countdown crosses the target at the expected epoch", () => {
  assert.equal(timeOfRound(10), QUICKNET_GENESIS + 30);
  assert.deepEqual(localCountdown(10, QUICKNET_GENESIS + 29), {
    currentRound: 9, targetRound: 10, secondsRemaining: 1,
    targetTime: QUICKNET_GENESIS + 30, published: false,
  });
  assert.equal(localCountdown(10, QUICKNET_GENESIS + 30).published, true);
  assert.equal(localCountdown(10, QUICKNET_GENESIS + 31).secondsRemaining, 0);
});
