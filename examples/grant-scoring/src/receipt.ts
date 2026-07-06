import type {
  GrantPilotProgram,
  GrantPilotReceipt,
  GrantRoundSnapshot,
  ProjectScoreAggregate,
} from "./types.js";

export function buildGrantReceipt(params: {
  program: GrantPilotProgram;
  roundSnapshots: GrantRoundSnapshot[];
  rankings: ProjectScoreAggregate[];
  generatedAt?: string;
}): GrantPilotReceipt {
  const allSettled = params.roundSnapshots.every((row) => row.status === "Settled");
  return {
    programId: params.program.id,
    title: params.program.title,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    contractId: params.program.contractId,
    revealRound: params.program.revealRound,
    criteria: params.program.criteria,
    judges: params.program.judges,
    projects: params.program.projects,
    rounds: params.roundSnapshots,
    rankings: params.rankings,
    settlementNote: allSettled
      ? "Nominal judge escrows refunded after settle; rankings computed from revealed scores."
      : "Settlement pending — run keeper settle after all reveals clear.",
  };
}
