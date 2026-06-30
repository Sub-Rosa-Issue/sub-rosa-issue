import { createHash } from "node:crypto";

import type { GrantPilotProgram } from "./types.js";
import { weightedCompositeScore } from "./scoring.js";

const sha256Ref = (ref: string): string =>
  createHash("sha256").update(ref).digest("hex");

export const PILOT_CRITERIA = [
  { id: "impact", label: "Ecosystem impact", weight: 0.4, maxScore: 10 },
  { id: "feasibility", label: "Delivery feasibility", weight: 0.3, maxScore: 10 },
  { id: "team", label: "Team strength", weight: 0.3, maxScore: 10 },
] as const;

export const PILOT_PROJECTS = [
  {
    id: "proj-stellar-finance",
    name: "Stellar Finance Hub",
    itemRef: "sub-rosa://grant-scoring/pilot/proj-stellar-finance",
  },
  {
    id: "proj-oracle-bridge",
    name: "Oracle Bridge SDK",
    itemRef: "sub-rosa://grant-scoring/pilot/proj-oracle-bridge",
  },
  {
    id: "proj-wallet-kit",
    name: "Wallet Kit Extensions",
    itemRef: "sub-rosa://grant-scoring/pilot/proj-wallet-kit",
  },
] as const;

export const PILOT_JUDGES = [
  {
    id: "judge-aurora",
    name: "Judge Aurora",
    stellarAddress: "GJUDGEAURORA000000000000000000000000000000000000000000000001",
  },
  {
    id: "judge-nova",
    name: "Judge Nova",
    stellarAddress: "GJUDGENOVA00000000000000000000000000000000000000000000000002",
  },
] as const;

/** Rubric breakdowns per (judge, project) — composite scores derived from weights. */
const CRITERIA_MATRIX: Record<
  string,
  Record<string, { impact: number; feasibility: number; team: number }>
> = {
  "judge-aurora": {
    "proj-stellar-finance": { impact: 9, feasibility: 8, team: 8 },
    "proj-oracle-bridge": { impact: 7, feasibility: 7, team: 8 },
    "proj-wallet-kit": { impact: 9, feasibility: 9, team: 9 },
  },
  "judge-nova": {
    "proj-stellar-finance": { impact: 8, feasibility: 8, team: 8 },
    "proj-oracle-bridge": { impact: 8, feasibility: 7, team: 8 },
    "proj-wallet-kit": { impact: 9, feasibility: 8, team: 9 },
  },
};

function buildScoreSheets() {
  const criteria = [...PILOT_CRITERIA];
  const sheets = [];
  for (const judge of PILOT_JUDGES) {
    for (const project of PILOT_PROJECTS) {
      const row = CRITERIA_MATRIX[judge.id]?.[project.id];
      if (!row) throw new Error(`missing fixture matrix for ${judge.id}/${project.id}`);
      const breakdown = [
        { criterionId: "impact", score: row.impact },
        { criterionId: "feasibility", score: row.feasibility },
        { criterionId: "team", score: row.team },
      ];
      sheets.push({
        judgeId: judge.id,
        projectId: project.id,
        compositeScore: weightedCompositeScore(criteria, breakdown),
        criteria: breakdown,
      });
    }
  }
  return sheets;
}

/** Fixture program — no live Stellar credentials required. */
export const PILOT_FIXTURE_PROGRAM: GrantPilotProgram = {
  id: "scf-pilot-2026-q2",
  title: "Sealed Grant Scoring Pilot",
  contractId: "CFIXTURE0000000000000000000000000000000000000000000000000000001",
  revealRound: 2_500_000,
  commitDeadline: 1_900_000_000,
  revealDeadline: 1_900_000_300,
  criteria: [...PILOT_CRITERIA],
  projects: [...PILOT_PROJECTS],
  judges: [...PILOT_JUDGES],
  scoreSheets: buildScoreSheets(),
  escrowStroops: 1_000_000n, // 0.1 USDC nominal lock per commit
};

export const PILOT_ITEM_REF_DIGESTS = Object.fromEntries(
  PILOT_PROJECTS.map((project) => [project.id, sha256Ref(project.itemRef)]),
);

/** Expected ranking order from fixture score sheets (highest average first). */
export const PILOT_EXPECTED_RANKING = [
  "proj-wallet-kit",
  "proj-stellar-finance",
  "proj-oracle-bridge",
] as const;
