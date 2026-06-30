import assert from "node:assert/strict";
import { test } from "node:test";

import { PILOT_FIXTURE_PROGRAM } from "./fixtures.js";
import { scoreToStroops, stroopsToDisplayScore, weightedCompositeScore } from "./scoring.js";

test("weightedCompositeScore applies criterion weights", () => {
  const score = weightedCompositeScore(PILOT_FIXTURE_PROGRAM.criteria, [
    { criterionId: "impact", score: 10 },
    { criterionId: "feasibility", score: 0 },
    { criterionId: "team", score: 0 },
  ]);
  assert.equal(score, 4);
});

test("scoreToStroops rejects negative values", () => {
  assert.throws(() => scoreToStroops(-1), /non-negative/);
});

test("stroopsToDisplayScore preserves one decimal place for pilot scores", () => {
  assert.equal(stroopsToDisplayScore(scoreToStroops(7.6)), 7.6);
});
