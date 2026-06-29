import type {
  GrantProject,
  JudgeCriteriaBreakdown,
  ProjectScoreAggregate,
  RevealedJudgeScore,
  ScoringCriterion,
} from "./types.js";

/** Scale factor: one display point = 1_000_000 stroops (matches 0.001 precision). */
export const SCORE_SCALE = 1_000_000n;

export function scoreToStroops(score: number): bigint {
  if (!Number.isFinite(score) || score < 0) {
    throw new Error(`score must be a non-negative finite number, got ${score}`);
  }
  return BigInt(Math.round(score * Number(SCORE_SCALE)));
}

export function stroopsToDisplayScore(stroops: bigint): number {
  return Number(stroops) / Number(SCORE_SCALE);
}

export function weightedCompositeScore(
  criteria: ScoringCriterion[],
  breakdown: JudgeCriteriaBreakdown[],
): number {
  const byId = new Map(breakdown.map((row) => [row.criterionId, row.score]));
  let total = 0;
  for (const criterion of criteria) {
    const raw = byId.get(criterion.id);
    if (raw == null) {
      throw new Error(`missing criterion score for ${criterion.id}`);
    }
    if (raw < 0 || raw > criterion.maxScore) {
      throw new Error(
        `${criterion.id} score ${raw} out of range 0–${criterion.maxScore}`,
      );
    }
    total += raw * criterion.weight;
  }
  return total;
}

export function rankProjects(
  projects: GrantProject[],
  revealed: RevealedJudgeScore[],
): ProjectScoreAggregate[] {
  const byProject = new Map<string, RevealedJudgeScore[]>();
  for (const row of revealed) {
    const bucket = byProject.get(row.projectId) ?? [];
    bucket.push(row);
    byProject.set(row.projectId, bucket);
  }

  const aggregates = projects.map((project) => {
    const judgeScores = byProject.get(project.id) ?? [];
    const roundId = judgeScores[0]?.roundId ?? 0n;
    const averageScore =
      judgeScores.length === 0
        ? 0
        : judgeScores.reduce((sum, row) => sum + row.displayScore, 0) /
          judgeScores.length;
    return {
      projectId: project.id,
      projectName: project.name,
      roundId,
      judgeScores,
      averageScore,
      rank: 0,
    };
  });

  aggregates.sort((a, b) => b.averageScore - a.averageScore);
  return aggregates.map((row, index) => ({ ...row, rank: index + 1 }));
}
