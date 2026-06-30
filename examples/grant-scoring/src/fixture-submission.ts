import { commitment, generateNonce } from "@sub-rosa/tlock";

import type { GrantPilotProgram, SealedScoreSubmission } from "./types.js";
import { scoreToStroops } from "./scoring.js";

export function buildFixtureSubmission(
  program: GrantPilotProgram,
  judgeId: string,
  projectId: string,
  roundId: bigint,
  compositeScore: number,
): SealedScoreSubmission & { nonce: Uint8Array } {
  const scoreStroops = scoreToStroops(compositeScore);
  const nonce = generateNonce();
  return {
    judgeId,
    projectId,
    roundId,
    scoreStroops,
    commitment: commitment(scoreStroops, nonce),
    ciphertext: new TextEncoder().encode("fixture-ciphertext"),
    auditorBlob: new Uint8Array(0),
    escrow: program.escrowStroops,
    nonce,
  };
}

export async function commitFixtureScore(
  client: {
    commit: (params: {
      roundId: bigint;
      sealed: {
        commitment: Uint8Array;
        ciphertext: Uint8Array;
        auditorBlob: Uint8Array;
      };
      escrow: bigint;
      bidder: string;
    }) => Promise<void>;
    registerFixtureSubmission: (
      submission: SealedScoreSubmission,
      bidder: string,
      nonce: Uint8Array,
    ) => void;
  },
  submission: SealedScoreSubmission & { nonce: Uint8Array },
  bidder: string,
): Promise<void> {
  await client.commit({
    roundId: submission.roundId,
    sealed: {
      commitment: submission.commitment,
      ciphertext: submission.ciphertext,
      auditorBlob: submission.auditorBlob,
    },
    escrow: submission.escrow,
    bidder,
  });
  client.registerFixtureSubmission(submission, bidder, submission.nonce);
}
