import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { commitment, generateNonce } from "@sub-rosa/tlock";

import {
  PILOT_EXPECTED_RANKING,
  PILOT_FIXTURE_PROGRAM,
  PILOT_JUDGES,
  PILOT_PROJECTS,
} from "./fixtures.js";
import { GrantScoringPilot } from "./pilot.js";
import { assessRevealReadiness } from "./reveal-readiness.js";
import { rankProjects, scoreToStroops, stroopsToDisplayScore, weightedCompositeScore } from "./scoring.js";

describe("GrantScoringPilot fixture lifecycle", () => {
  test("runs sealed-score lifecycle for 2 judges and 3 projects", async () => {
    const pilot = new GrantScoringPilot();
    const receipt = await pilot.runFixtureLifecycle();

    assert.equal(receipt.judges.length, 2);
    assert.equal(receipt.projects.length, 3);
    assert.equal(receipt.rounds.length, 3);
    assert.equal(receipt.rankings.length, 3);
    assert.equal(receipt.rounds.every((r) => r.status === "Settled"), true);
    assert.equal(receipt.rounds.every((r) => r.bidderCount === 2), true);
    assert.equal(receipt.rounds.every((r) => r.revealedCount === 2), true);

    const rankedIds = receipt.rankings.map((row) => row.projectId);
    assert.deepEqual(rankedIds, [...PILOT_EXPECTED_RANKING]);

    const top = receipt.rankings[0];
    assert.equal(top.projectId, "proj-wallet-kit");
    assert.ok(top.averageScore > receipt.rankings[1].averageScore);
    assert.ok(receipt.rankings[1].averageScore > receipt.rankings[2].averageScore);
  });

  test("reveal readiness tracks commit progress", async () => {
    const pilot = new GrantScoringPilot();
    await pilot.createProjectRounds();
    const client = pilot.fixtureClient();

    let report = await assessRevealReadiness(
      client,
      PILOT_FIXTURE_PROGRAM,
      pilot.state.roundBindings,
    );
    assert.equal(report.expectedSubmissions, 6);
    assert.equal(report.committedSubmissions, 0);
    assert.equal(report.allScoresCommitted, false);
    assert.equal(report.phase, "accepting-scores");

    await pilot.submitAllFixtureScores();
    report = await assessRevealReadiness(
      client,
      PILOT_FIXTURE_PROGRAM,
      pilot.state.roundBindings,
    );
    assert.equal(report.committedSubmissions, 6);
    assert.equal(report.allScoresCommitted, true);
    assert.equal(report.phase, "awaiting-reveal");
    assert.equal(report.pendingProjects.length, 0);
  });

  test("sealed commitments verify at reveal using @sub-rosa/tlock vectors", async () => {
    const pilot = new GrantScoringPilot();
    await pilot.createProjectRounds();
    await pilot.submitAllFixtureScores();
    const client = pilot.fixtureClient();
    const binding = pilot.state.roundBindings[0];
    const judge = PILOT_JUDGES[0];
    const stored = client.fixtureBid(binding.roundId, judge.stellarAddress);
    assert.ok(stored);
    const expected = commitment(stored.scoreStroops, stored.nonce);
    assert.equal(Buffer.from(expected).compare(Buffer.from(stored.commitment)), 0);
  });
});

describe("fixture data coverage", () => {
  test("includes at least two judges and three projects", () => {
    assert.ok(PILOT_JUDGES.length >= 2);
    assert.ok(PILOT_PROJECTS.length >= 3);
    assert.equal(PILOT_FIXTURE_PROGRAM.scoreSheets.length, PILOT_JUDGES.length * PILOT_PROJECTS.length);
  });

  test("criteria weights produce composite scores in range", () => {
    for (const sheet of PILOT_FIXTURE_PROGRAM.scoreSheets) {
      const composite = weightedCompositeScore(
        PILOT_FIXTURE_PROGRAM.criteria,
        sheet.criteria,
      );
      assert.equal(sheet.compositeScore, composite);
      assert.ok(composite >= 0 && composite <= 10);
    }
  });

  test("score stroops round-trip display values", () => {
    const stroops = scoreToStroops(8.5);
    assert.equal(stroopsToDisplayScore(stroops), 8.5);
    const nonce = generateNonce();
    const h = commitment(stroops, nonce);
    assert.equal(h.length, 32);
  });
});

describe("rankProjects", () => {
  test("orders projects by average judge score descending", () => {
    const revealed = [
      {
        judgeId: "judge-aurora",
        projectId: "proj-a",
        roundId: 1n,
        scoreStroops: scoreToStroops(9),
        displayScore: 9,
      },
      {
        judgeId: "judge-nova",
        projectId: "proj-a",
        roundId: 1n,
        scoreStroops: scoreToStroops(7),
        displayScore: 7,
      },
      {
        judgeId: "judge-aurora",
        projectId: "proj-b",
        roundId: 2n,
        scoreStroops: scoreToStroops(6),
        displayScore: 6,
      },
      {
        judgeId: "judge-nova",
        projectId: "proj-b",
        roundId: 2n,
        scoreStroops: scoreToStroops(8),
        displayScore: 8,
      },
    ];
    const projects = [
      { id: "proj-a", name: "A", itemRef: "sub-rosa://a" },
      { id: "proj-b", name: "B", itemRef: "sub-rosa://b" },
    ];
    const ranked = rankProjects(projects, revealed);
    assert.equal(ranked[0].projectId, "proj-a");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[0].averageScore, 8);
    assert.equal(ranked[1].projectId, "proj-b");
  });
});
