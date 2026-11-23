// Copyright (c) 2026 Sub Rosa contributors
// Shared reveal-phase resolution tests (lib + hook).
//
// The hook logic is exercised through ObserverView/AttackDemo component
// tests (which render through TimeProvider without a wallet); this file pins
// the local-countdown contract the hook relies on for evidence mode.

import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_TRACE } from "../demo/trace";
import { localCountdown } from "./countdown";

const R = DEMO_TRACE.meta.revealRound;

test("localCountdown gates on Drand R publish time, not trace status", () => {
  const before = localCountdown(R, 0);
  assert.equal(before.published, false);
  assert.ok(before.secondsRemaining > 0);

  const at = localCountdown(R, before.targetTime);
  assert.equal(at.published, true);
  assert.equal(at.secondsRemaining, 0);

  const after = localCountdown(R, before.targetTime + 1);
  assert.equal(after.published, true);
});
