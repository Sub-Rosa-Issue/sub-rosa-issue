import { createHash } from "node:crypto";

import type { CreateRoundParams, SubRosaClient } from "@sub-rosa/sdk";
import {
  generateAuditorKeypair,
  generateNonce,
  quicknet,
  sealBid,
  type DrandClient,
  type SealedBid,
} from "@sub-rosa/tlock";

import type { GrantJudge, GrantPilotProgram, GrantProject, SealedScoreSubmission } from "./types.js";
import { scoreToStroops } from "./scoring.js";

export interface SealJudgeScoreParams {
  program: GrantPilotProgram;
  judge: GrantJudge;
  project: GrantProject;
  roundId: bigint;
  compositeScore: number;
  auditorPublicKey: Uint8Array;
  drand?: DrandClient;
}

export interface CommitSealedScoreParams extends SealJudgeScoreParams {
  client: SubRosaClient;
}

function judgeIdentity(judgeId: string, projectId: string): Uint8Array {
  return new TextEncoder().encode(`grant-judge:${judgeId}:project:${projectId}`);
}

/** Seal one judge score with @sub-rosa/tlock — same path a live pilot uses. */
export async function sealJudgeScore(
  params: SealJudgeScoreParams,
): Promise<SealedScoreSubmission> {
  const scoreStroops = scoreToStroops(params.compositeScore);
  const nonce = generateNonce();
  const drand = params.drand ?? quicknet();
  const sealed: SealedBid = await sealBid({
    value: scoreStroops,
    nonce,
    round: params.program.revealRound,
    client: drand,
    identity: judgeIdentity(params.judge.id, params.project.id),
    auditorPublicKey: params.auditorPublicKey,
  });

  return {
    judgeId: params.judge.id,
    projectId: params.project.id,
    roundId: params.roundId,
    scoreStroops,
    commitment: sealed.commitment,
    ciphertext: sealed.ciphertext,
    auditorBlob: sealed.auditorBlob,
    escrow: params.program.escrowStroops,
  };
}

/** Seal then commit via @sub-rosa/sdk — integration-layer submit path. */
export async function commitSealedJudgeScore(
  params: CommitSealedScoreParams,
): Promise<SealedScoreSubmission> {
  const submission = await sealJudgeScore(params);
  await params.client.commit({
    roundId: params.roundId,
    sealed: {
      commitment: submission.commitment,
      ciphertext: submission.ciphertext,
      auditorBlob: submission.auditorBlob,
    },
    escrow: submission.escrow,
    bidder: params.judge.stellarAddress,
  });
  return submission;
}

export interface CreateProjectRoundParams {
  client: SubRosaClient;
  program: GrantPilotProgram;
  project: GrantProject;
  auditorPubkey: Uint8Array;
  operator?: string;
}

/** Create one Soroban round per grant project (shared reveal time). */
export async function createProjectRound(
  params: CreateProjectRoundParams,
): Promise<bigint> {
  const digest = createHash("sha256").update(params.project.itemRef).digest();
  const roundParams: CreateRoundParams = {
    itemRef: digest,
    revealRound: params.program.revealRound,
    commitDeadline: params.program.commitDeadline,
    revealDeadline: params.program.revealDeadline,
    auditorPubkey: params.auditorPubkey,
    clearingRule: "HighestBid",
    ...(params.operator ? { operator: params.operator } : {}),
  };
  return params.client.createRound(roundParams);
}

export function generatePilotAuditor() {
  return generateAuditorKeypair();
}
