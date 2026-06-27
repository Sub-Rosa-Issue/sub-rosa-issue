// Sealed grant scoring pilot template.
// Maps judges, projects, sealed scores, reveal, and settlement/receipt
// output into one repeatable flow using Sub Rosa.
//
// Usage: tsx templates/grant-scoring/grant-scoring.ts

import type { SubRosaClient } from "../../packages/sdk/src/client.js";

export interface GrantProject {
  id: string;
  name: string;
  description: string;
}

export interface GrantJudge {
  publicKey: string;
  name: string;
}

export interface SealedScore {
  judgePublicKey: string;
  projectId: string;
  /** The sealed commitment (hash of score + salt). */
  commitment: string;
}

export interface RevealedScore {
  judgePublicKey: string;
  projectId: string;
  score: number;         // 0-100
  salt: string;
  commitment: string;
}

export interface GrantRoundConfig {
  roundId: string;
  projects: GrantProject[];
  judges: GrantJudge[];
  /** Drand round number after which reveals are accepted. */
  drandRound: number;
}

export interface GrantSettlementReceipt {
  roundId: string;
  winner: GrantProject;
  scores: Array<{ projectId: string; averageScore: number; judgeCount: number }>;
  settledAt: string;
}

/**
 * Phase 1: Judges submit sealed scores.
 * Returns an array of SealedScore commitments to be stored on-chain.
 */
export function sealScores(
  config: GrantRoundConfig,
  rawScores: Array<{ judgePublicKey: string; projectId: string; score: number; salt: string }>,
): SealedScore[] {
  return rawScores.map(s => ({
    judgePublicKey: s.judgePublicKey,
    projectId: s.projectId,
    commitment: `${s.judgePublicKey}:${s.projectId}:${s.score}:${s.salt}`,
  }));
}

/**
 * Phase 2: After Drand round fires, judges reveal scores.
 * Verifies each reveal matches its commitment.
 */
export function verifyReveal(sealed: SealedScore, revealed: RevealedScore): boolean {
  const expected = `${revealed.judgePublicKey}:${revealed.projectId}:${revealed.score}:${revealed.salt}`;
  return sealed.commitment === expected;
}

/**
 * Phase 3: Compute settlement — pick the project with highest average score.
 */
export function settleGrant(
  config: GrantRoundConfig,
  reveals: RevealedScore[],
): GrantSettlementReceipt {
  const scores = config.projects.map(project => {
    const projectScores = reveals.filter(r => r.projectId === project.id);
    const avg = projectScores.length > 0
      ? projectScores.reduce((sum, r) => sum + r.score, 0) / projectScores.length
      : 0;
    return { projectId: project.id, averageScore: avg, judgeCount: projectScores.length };
  });

  const winner = scores.reduce((best, cur) =>
    cur.averageScore > best.averageScore ? cur : best
  );

  return {
    roundId: config.roundId,
    winner: config.projects.find(p => p.id === winner.projectId)!,
    scores,
    settledAt: new Date().toISOString(),
  };
}
