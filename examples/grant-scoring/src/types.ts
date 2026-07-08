/** Weighted rubric row shown to judges before they seal a score. */
export interface ScoringCriterion {
  id: string;
  label: string;
  /** Relative weight (should sum to 1 across criteria). */
  weight: number;
  maxScore: number;
}

/** A grant applicant tracked in the pilot program. */
export interface GrantProject {
  id: string;
  name: string;
  /** Off-chain ref hashed into the Soroban round `item_ref`. */
  itemRef: string;
}

/** Panel member who submits one sealed score per project round. */
export interface GrantJudge {
  id: string;
  name: string;
  /** Stellar G-address used as the on-chain bidder identity. */
  stellarAddress: string;
}

export interface JudgeCriteriaBreakdown {
  criterionId: string;
  score: number;
}

/** Raw judge input before sealing — one row per (judge, project) pair. */
export interface JudgeScoreSheet {
  judgeId: string;
  projectId: string;
  /** Composite score on the program scale (e.g. 0–10). */
  compositeScore: number;
  criteria: JudgeCriteriaBreakdown[];
}

export type GrantPilotPhase =
  | "draft"
  | "accepting-scores"
  | "awaiting-reveal"
  | "revealing"
  | "ranked";

export interface SealedScoreSubmission {
  judgeId: string;
  projectId: string;
  roundId: bigint;
  scoreStroops: bigint;
  commitment: Uint8Array;
  ciphertext: Uint8Array;
  auditorBlob: Uint8Array;
  escrow: bigint;
}

export interface RevealedJudgeScore {
  judgeId: string;
  projectId: string;
  roundId: bigint;
  scoreStroops: bigint;
  displayScore: number;
}

export interface ProjectScoreAggregate {
  projectId: string;
  projectName: string;
  roundId: bigint;
  judgeScores: RevealedJudgeScore[];
  averageScore: number;
  rank: number;
}

export interface GrantRoundSnapshot {
  projectId: string;
  roundId: bigint;
  status: string;
  bidderCount: number;
  revealedCount: number;
}

export interface GrantPilotReceipt {
  programId: string;
  title: string;
  generatedAt: string;
  contractId: string;
  revealRound: number;
  criteria: ScoringCriterion[];
  judges: GrantJudge[];
  projects: GrantProject[];
  rounds: GrantRoundSnapshot[];
  rankings: ProjectScoreAggregate[];
  settlementNote: string;
}

export interface GrantPilotProgram {
  id: string;
  title: string;
  contractId: string;
  revealRound: number;
  commitDeadline: number;
  revealDeadline: number;
  criteria: ScoringCriterion[];
  projects: GrantProject[];
  judges: GrantJudge[];
  scoreSheets: JudgeScoreSheet[];
  /** Nominal USDC escrow per sealed score commit (refunded after settle). */
  escrowStroops: bigint;
}
