import assert from "node:assert/strict";
import { test } from "node:test";

import { PILOT_FIXTURE_PROGRAM } from "./fixtures.js";
import { FixtureGrantClient } from "./fixture-client.js";
import { assessRevealReadiness } from "./reveal-readiness.js";

test("assessRevealReadiness reports partial commits per project round", async () => {
  const client = new FixtureGrantClient(PILOT_FIXTURE_PROGRAM.contractId);
  const roundId = await client.createRound({
    itemRef: new Uint8Array(32),
    revealRound: PILOT_FIXTURE_PROGRAM.revealRound,
    commitDeadline: PILOT_FIXTURE_PROGRAM.commitDeadline,
    revealDeadline: PILOT_FIXTURE_PROGRAM.revealDeadline,
    auditorPubkey: new Uint8Array(96),
  });

  await client.commit({
    roundId,
    sealed: {
      commitment: new Uint8Array(32).fill(1),
      ciphertext: new Uint8Array(8),
      auditorBlob: new Uint8Array(0),
    },
    escrow: 1n,
    bidder: PILOT_FIXTURE_PROGRAM.judges[0].stellarAddress,
  });

  const report = await assessRevealReadiness(
    client,
    PILOT_FIXTURE_PROGRAM,
    [{ projectId: PILOT_FIXTURE_PROGRAM.projects[0].id, roundId }],
  );

  assert.equal(report.expectedSubmissions, 6);
  assert.equal(report.committedSubmissions, 1);
  assert.equal(report.allScoresCommitted, false);
  assert.equal(report.roundsReady, 0);
  assert.equal(report.pendingProjects.length, 1);
});
