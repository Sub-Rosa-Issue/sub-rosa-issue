import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeRoundStatus,
  isRoundOpen,
  isTerminalRoundStatus,
} from "./status.js";

test("describeRoundStatus labels each status", () => {
  assert.equal(describeRoundStatus("Open"), "Open for commits");
  assert.equal(describeRoundStatus("Revealing"), "Reveal window open");
  assert.equal(describeRoundStatus("Settled"), "Settled");
  assert.equal(describeRoundStatus("Unknown"), "Unknown");
});

test("isRoundOpen is true only for Open", () => {
  assert.equal(isRoundOpen("Open"), true);
  assert.equal(isRoundOpen("Settled"), false);
  assert.equal(isRoundOpen("Voided"), false);
  assert.equal(isRoundOpen("Unknown"), false);
});

test("isTerminalRoundStatus is true for settled/voided only", () => {
  assert.equal(isTerminalRoundStatus("Settled"), true);
  assert.equal(isTerminalRoundStatus("Voided"), true);
  assert.equal(isTerminalRoundStatus("Open"), false);
  assert.equal(isTerminalRoundStatus("Revealing"), false);
  assert.equal(isTerminalRoundStatus("Cleared"), false);
});
