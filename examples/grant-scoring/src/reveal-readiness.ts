import type { SubRosaClient } from "@sub-rosa/sdk";

import type { GrantPilotPhase, GrantPilotProgram } from "./types.js";

export interface RevealReadinessReport {
  phase: GrantPilotPhase;
  expectedSubmissions: number;
  committedSubmissions: number;
  allScoresCommitted: boolean;
  roundsReady: number;
  totalRounds: number;
  pendingProjects: string[];
  message: string;
}

export interface RoundBinding {
  projectId: string;
  roundId: bigint;
}

export async function assessRevealReadiness(
  client: Pick<SubRosaClient, "getRound" | "getBidders">,
  program: GrantPilotProgram,
  roundBindings: RoundBinding[],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RevealReadinessReport> {
  const expectedSubmissions = program.judges.length * program.projects.length;
  let committedSubmissions = 0;
  let roundsReady = 0;
  const pendingProjects: string[] = [];

  for (const binding of roundBindings) {
    const round = await client.getRound(binding.roundId);
    const bidders = await client.getBidders(binding.roundId);
    committedSubmissions += bidders.length;
    const allJudgesCommitted = program.judges.every((judge) =>
      bidders.includes(judge.stellarAddress),
    );
    if (allJudgesCommitted) {
      roundsReady += 1;
    } else {
      pendingProjects.push(binding.projectId);
    }

    if (round.status.tag === "Open" && nowSeconds > Number(round.commit_deadline)) {
      // Commit window closed — still awaiting Drand R before reveal opens.
    }
  }

  const allScoresCommitted = committedSubmissions === expectedSubmissions;
  let phase: GrantPilotPhase = "accepting-scores";
  let message = "Waiting for judges to submit sealed scores.";

  if (allScoresCommitted) {
    phase = "awaiting-reveal";
    message =
      "All sealed scores committed. Open reveal after Drand round R is published.";
  }
  if (roundBindings.length > 0) {
    const statuses = await Promise.all(
      roundBindings.map((b) => client.getRound(b.roundId)),
    );
    if (statuses.every((r) => r.status.tag === "Revealing")) {
      phase = "revealing";
      message = "Reveal window open — decrypt seals and submit reveals.";
    }
    if (statuses.every((r) => r.status.tag === "Settled")) {
      phase = "ranked";
      message = "All project rounds settled — rankings and receipt are final.";
    }
  }

  return {
    phase,
    expectedSubmissions,
    committedSubmissions,
    allScoresCommitted,
    roundsReady,
    totalRounds: roundBindings.length,
    pendingProjects,
    message,
  };
}
