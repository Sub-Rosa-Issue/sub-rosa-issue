import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createFakeTime,
  createSystemScheduler,
  FakeClock,
  FakeScheduler,
} from "./index.js";

describe("FakeScheduler", () => {
  it("runs timeouts in due-time order without real waiting", async () => {
    const { clock, scheduler } = createFakeTime(0);
    const order: number[] = [];
    scheduler.setTimeout(() => order.push(2), 200);
    scheduler.setTimeout(() => order.push(1), 100);
    scheduler.advance(100);
    assert.deepEqual(order, [1]);
    scheduler.advance(100);
    assert.deepEqual(order, [1, 2]);
    assert.equal(clock.nowMs(), 200);
  });

  it("reschedules intervals and supports cancellation", () => {
    const { clock, scheduler } = createFakeTime(0);
    let ticks = 0;
    const handle = scheduler.setInterval(() => {
      ticks += 1;
    }, 50);
    scheduler.advance(125);
    assert.equal(ticks, 2);
    scheduler.clear(handle);
    scheduler.advance(100);
    assert.equal(ticks, 2);
    assert.equal(clock.nowMs(), 225);
  });

  it("resolves sleep when time advances", async () => {
    const { clock, scheduler } = createFakeTime(0);
    let done = false;
    const pending = scheduler.sleep(500).then(() => {
      done = true;
    });
    assert.equal(done, false);
    scheduler.advance(499);
    assert.equal(done, false);
    scheduler.advance(1);
    await pending;
    assert.equal(done, true);
    assert.equal(clock.nowMs(), 500);
  });

  it("rejects sleep on abort", async () => {
    const { scheduler } = createFakeTime(0);
    const controller = new AbortController();
    const pending = scheduler.sleep(1_000, controller.signal);
    controller.abort();
    await assert.rejects(pending, (e: unknown) => e instanceof DOMException);
  });

  it("cancelAll clears pending sleep and timers", async () => {
    const { scheduler } = createFakeTime(0);
    let fired = false;
    scheduler.setTimeout(() => {
      fired = true;
    }, 100);
    const sleepRejected = scheduler.sleep(100).then(
      () => "ok" as const,
      () => "rejected" as const,
    );
    scheduler.cancelAll();
    scheduler.advance(200);
    assert.equal(fired, false);
    assert.equal(await sleepRejected, "rejected");
    assert.equal(scheduler.pendingCount(), 0);
  });
});

describe("commit/reveal boundary seconds", () => {
  it("preserves inclusive deadline comparisons at second boundaries", () => {
    const clock = new FakeClock(1_999);
    const commitDeadline = 2;
    assert.ok(clock.nowSeconds() < commitDeadline);
    clock.advance(1);
    assert.equal(clock.nowSeconds(), commitDeadline);
    assert.ok(clock.nowSeconds() <= commitDeadline);
    clock.advance(1000);
    assert.ok(clock.nowSeconds() > commitDeadline);
  });
});

describe("createSystemScheduler", () => {
  it("executes a zero-delay timeout", async () => {
    const scheduler = createSystemScheduler();
    let ran = false;
    await new Promise<void>((resolve) => {
      scheduler.setTimeout(() => {
        ran = true;
        resolve();
      }, 0);
    });
    assert.equal(ran, true);
    scheduler.cancelAll();
  });
});

describe("simultaneous timers", () => {
  it("fires same-ms timeouts in registration order", () => {
    const clock = new FakeClock(0);
    const scheduler = new FakeScheduler(clock);
    const order: string[] = [];
    scheduler.setTimeout(() => order.push("a"), 10);
    scheduler.setTimeout(() => order.push("b"), 10);
    scheduler.setTimeout(() => order.push("c"), 10);
    scheduler.advance(10);
    assert.deepEqual(order, ["a", "b", "c"]);
  });
});
