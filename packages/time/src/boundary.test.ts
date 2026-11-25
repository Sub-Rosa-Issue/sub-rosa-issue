import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFakeTime } from "./index.js";

describe("keeper-style poll pacing", () => {
  it("preserves pollMs minus elapsed semantics", async () => {
    const { clock, scheduler } = createFakeTime(0);
    const pollMs = 1_000;
    const started = clock.nowMs();
    const firstWait = scheduler.sleep(300);
    scheduler.advance(300);
    await firstWait;
    const elapsed = clock.nowMs() - started;
    const wait = Math.max(0, pollMs - elapsed);
    assert.equal(wait, 700);
    const secondWait = scheduler.sleep(wait);
    scheduler.advance(wait);
    await secondWait;
    assert.equal(clock.nowMs(), 1_000);
  });
});

describe("inclusive confirm timeout deadline", () => {
  it("matches clock + timeout polling semantics", async () => {
    const { clock, scheduler } = createFakeTime(0);
    const confirmTimeout = 5_000;
    const pollInterval = 1_500;
    const deadline = clock.nowMs() + confirmTimeout;
    let polls = 0;

    while (clock.nowMs() < deadline) {
      polls += 1;
      const pending = scheduler.sleep(pollInterval);
      scheduler.advance(pollInterval);
      await pending;
    }

    assert.ok(polls >= 3);
    assert.ok(clock.nowMs() >= deadline);
  });
});

describe("quicknet round reveal boundary", () => {
  it("treats exact boundary as open and one millisecond earlier as closed", () => {
    const genesisTime = 1_692_803_367;
    const period = 3;
    const targetRound = 10;
    const boundaryMs = (genesisTime + period * targetRound) * 1000;

    const { clock } = createFakeTime(boundaryMs - 1);
    const isOpenBefore = clock.nowMs() >= boundaryMs;
    assert.equal(isOpenBefore, false, "one millisecond before boundary must stay closed");

    clock.advance(1);
    assert.equal(clock.nowMs(), boundaryMs);
    const isOpenAt = clock.nowMs() >= boundaryMs;
    assert.equal(isOpenAt, true, "at boundary reveal becomes available");

    // stays open through the full period including the last second
    clock.advance(period * 1000 - 1);
    assert.equal(
      clock.nowMs() >= boundaryMs,
      true,
      "reveal stays available through the last second of the period",
    );
  });
});

