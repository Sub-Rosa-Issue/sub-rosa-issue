// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import type { RoundStatus } from "../dashboard/types";
import {
  classifyRoundPhase,
  isRevealPhase,
  roundStatusFromTag,
  type RoundPhase,
} from "./round-phase";

const expected: Record<RoundStatus, readonly [RoundPhase, RoundPhase]> = {
  Open: ["Open", "Reveal"],
  Revealing: ["Reveal", "Reveal"],
  Cleared: ["Reveal", "Reveal"],
  Settled: ["Settled", "Settled"],
  Voided: ["Settled", "Settled"],
};
for (const status of Object.keys(expected) as RoundStatus[]) {
  for (const drandPublished of [false, true]) {
    test(`${status} with drandPublished=${drandPublished}`, () => {
      assert.equal(classifyRoundPhase({ status, drandPublished }),
        expected[status][drandPublished ? 1 : 0]);
    });
  }
}

test("only the Open phase is sealed; Reveal and Settled expose bid values", () => {
  assert.equal(isRevealPhase("Open"), false);
  assert.equal(isRevealPhase("Reveal"), true);
  assert.equal(isRevealPhase("Settled"), true);
});

test("roundStatusFromTag maps known statuses and seals unknown ones as Open", () => {
  for (const status of ["Open", "Revealing", "Cleared", "Settled", "Voided"] as RoundStatus[]) {
    assert.equal(roundStatusFromTag(status), status);
  }
  assert.equal(roundStatusFromTag("SomethingNew"), "Open");
  assert.equal(roundStatusFromTag(""), "Open");
  assert.equal(roundStatusFromTag(null), "Open");
  assert.equal(roundStatusFromTag(undefined), "Open");
});
