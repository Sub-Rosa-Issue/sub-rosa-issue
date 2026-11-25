// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { motionEnabled, type NonessentialMotion } from "./reduced-motion.js";

const KINDS: NonessentialMotion[] = ["confetti", "count-up", "nonessential"];

test("reduced motion disables confetti, count-up, and nonessential motion", () => {
  for (const kind of KINDS) {
    assert.equal(motionEnabled(kind, true), false);
  }
});

test("motion stays available when the preference is off or unknown", () => {
  for (const kind of KINDS) {
    assert.equal(motionEnabled(kind, false), true);
    assert.equal(motionEnabled(kind, null), true);
  }
});

test("stylesheets stop confetti and seal pulses under reduced motion", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../styles");
  const feedback = readFileSync(resolve(root, "feedback.css"), "utf8");
  const landing = readFileSync(resolve(root, "landing.css"), "utf8");
  assert.match(feedback, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.confetti-piece/);
  assert.match(landing, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.seal-pulse/);
});
