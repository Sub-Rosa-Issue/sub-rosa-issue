import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FakeClock, systemClock } from "./index.js";

describe("FakeClock", () => {
  it("starts at configured instant", () => {
    const clock = new FakeClock(1_700_000_000_000);
    assert.equal(clock.nowMs(), 1_700_000_000_000);
    assert.equal(clock.nowSeconds(), 1_700_000_000);
  });

  it("advances and sets deterministically", () => {
    const clock = new FakeClock(0);
    clock.advance(1_500);
    assert.equal(clock.nowMs(), 1_500);
    clock.set(9_000);
    assert.equal(clock.nowMs(), 9_000);
  });

  it("formats ISO strings from fake instants", () => {
    const clock = new FakeClock(0);
    assert.equal(clock.toISOString(), "1970-01-01T00:00:00.000Z");
  });
});

describe("systemClock", () => {
  it("returns plausible wall-clock values", () => {
    const first = systemClock.nowMs();
    const ms = systemClock.nowMs();
    const second = systemClock.nowMs();
    assert.ok(ms >= first && ms <= second);
    assert.equal(systemClock.nowSeconds(), Math.floor(ms / 1000));
  });
});
