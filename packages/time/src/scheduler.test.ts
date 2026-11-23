import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFakeTime, createSystemScheduler } from "./index.js";

describe("system scheduler sleep", () => {
  it("resolves immediately for non-positive delay", async () => {
    const scheduler = createSystemScheduler();
    await scheduler.sleep(0);
    await scheduler.sleep(-5);
    scheduler.cancelAll();
  });
});

describe("fake scheduler boundary tests", () => {
  it("models reveal deadline polling without real sleeps", async () => {
    const { clock, scheduler } = createFakeTime(1_000_000_000_000);
    const revealDeadline = clock.nowSeconds() + 30;
    let polls = 0;

    async function waitUntilRevealClear(): Promise<void> {
      while (clock.nowSeconds() <= revealDeadline + 3) {
        polls += 1;
        const remain = revealDeadline + 4 - clock.nowSeconds();
        if (remain > 0) {
          await scheduler.sleep(Math.min(5_000, remain * 1_000));
        }
      }
    }

    const pending = waitUntilRevealClear();
    scheduler.advance(40_000);
    await pending;
    assert.ok(polls >= 1);
    assert.ok(clock.nowSeconds() > revealDeadline + 3);
  });
});

describe("scheduler.test re-exports", () => {
  it("placeholder for module graph", () => {
    assert.ok(createFakeTime);
  });
});
