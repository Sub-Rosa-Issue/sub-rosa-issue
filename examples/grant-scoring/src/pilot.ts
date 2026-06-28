import { createHash } from "node:crypto";

import type { SubRosaClient } from "@sub-rosa/sdk";
import { commitment, generateNonce } from "@sub-rosa/tlock";

import { FixtureGrantClient } from "./fixture-client.js";
import { buildFixtureSubmission, commitFixtureScore } from "./fixture-submission.js";
import { PILOT_FIXTURE_PROGRAM } from "./fixtures.js";
import { buildGrantReceipt } from "./receipt.js";
import { assessRevealReadiness, type RoundBinding } from "./reveal-readiness.js";
import { rankProjects, stroopsToDisplayScore } from "./scoring.js";
import { createProjectRound, generatePilotAuditor } from "./seal-score.js";
import type {
  GrantPilotPhase,
  GrantPilotProgram,
  GrantPilotReceipt,
  RevealedJudgeScore,
  SealedScoreSubmission,
} from "./types.js";

export interface GrantScoringPilotState {
  phase: GrantPilotPhase;
  roundBindings: RoundBinding[];
  submissions: SealedScoreSubmission[];
  revealed: RevealedJudgeScore[];
  receipt?: GrantPilotReceipt;
}

export interface GrantScoringPilotOptions {
  program?: GrantPilotProgram;
  /** When true (default), use FixtureGrantClient — no RPC credentials. */
  fixtureMode?: boolean;
}

/**
 * Integration-layer orchestrator for sealed grant scoring pilots.
 * Distinct from the jury demo trace in services/agent and apps/web.
 */
export class GrantScoringPilot {
  readonly program: GrantPilotProgram;
  readonly fixtureMode: boolean;
  readonly auditor = generatePilotAuditor();
  readonly #fixtureClient: FixtureGrantClient | null;
  #state: GrantScoringPilotState = {
    phase: "draft",
    roundBindings: [],
    submissions: [],
    revealed: [],
  };

  constructor(options: GrantScoringPilotOptions = {}) {
    this.program = options.program ?? PILOT_FIXTURE_PROGRAM;
    this.fixtureMode = options.fixtureMode ?? true;
    this.#fixtureClient = this.fixtureMode
      ? new FixtureGrantClient(this.program.contractId)
      : null;
  }

  get state(): GrantScoringPilotState {
    return this.#state;
  }

  fixtureClient(): FixtureGrantClient {
    if (!this.#fixtureClient) {
      throw new Error("fixture client unavailable in live mode");
    }
    return this.#fixtureClient;
  }

  /** Step 1 — create one Soroban round per project with a shared reveal time. */
  async createProjectRounds(
    client: Pick<SubRosaClient, "createRound"> = this.#requireClient(),
  ): Promise<RoundBinding[]> {
    const bindings: RoundBinding[] = [];
    for (const project of this.program.projects) {
      const itemRef = createHash("sha256").update(project.itemRef).digest();
      const roundId = await client.createRound({
        itemRef,
        revealRound: this.program.revealRound,
        commitDeadline: this.program.commitDeadline,
        revealDeadline: this.program.revealDeadline,
        auditorPubkey: this.auditor.publicKey,
        clearingRule: "HighestBid",
      });
      bindings.push({ projectId: project.id, roundId });
      this.#fixtureClient?.linkProjectRound(project.id, roundId);
    }
    this.#state = { ...this.#state, phase: "accepting-scores", roundBindings: bindings };
    return bindings;
  }

  /** Step 2 — each judge seals and commits one score per project round. */
  async submitAllFixtureScores(): Promise<SealedScoreSubmission[]> {
    const client = this.#requireClient();
    const bindings = this.#state.roundBindings;
    if (bindings.length === 0) {
      throw new Error("create project rounds before submitting scores");
    }

    const submissions: SealedScoreSubmission[] = [];
    for (const sheet of this.program.scoreSheets) {
      const binding = bindings.find((b) => b.projectId === sheet.projectId);
      if (!binding) throw new Error(`no round for project ${sheet.projectId}`);
      const judge = this.program.judges.find((j) => j.id === sheet.judgeId);
      if (!judge) throw new Error(`unknown judge ${sheet.judgeId}`);

      const submission = buildFixtureSubmission(
        this.program,
        sheet.judgeId,
        sheet.projectId,
        binding.roundId,
        sheet.compositeScore,
      );
      await commitFixtureScore(
        client as FixtureGrantClient,
        submission,
        judge.stellarAddress,
      );
      submissions.push(submission);
    }

    const readiness = await assessRevealReadiness(
      client as Pick<SubRosaClient, "getRound" | "getBidders">,
      this.program,
      bindings,
    );
    this.#state = {
      ...this.#state,
      phase: readiness.phase,
      submissions,
    };
    return submissions;
  }

  /** Step 3 — simulate Drand R publication and open reveal on every project round. */
  async openAllReveals(
    client: Pick<SubRosaClient, "openReveal" | "getRound"> = this.#requireClient(),
    drandSignature: Uint8Array = new Uint8Array(96).fill(0xab),
  ): Promise<void> {
    for (const binding of this.#state.roundBindings) {
      await client.openReveal(binding.roundId, drandSignature);
    }
    const readiness = await assessRevealReadiness(
      client as Pick<SubRosaClient, "getRound" | "getBidders">,
      this.program,
      this.#state.roundBindings,
    );
    this.#state = { ...this.#state, phase: readiness.phase };
  }

  /** Step 4 — reveal every judge score (fixture mode uses stored nonces). */
  async revealAllScores(
    client: Pick<
      SubRosaClient,
      "reveal" | "getBidders" | "getRound"
    > = this.#requireClient(),
  ): Promise<RevealedJudgeScore[]> {
    const fixture = this.#fixtureClient;
    const revealed: RevealedJudgeScore[] = [];

    for (const binding of this.#state.roundBindings) {
      const bidders = await client.getBidders(binding.roundId);
      for (const bidder of bidders) {
        const judge = this.program.judges.find((j) => j.stellarAddress === bidder);
        if (!judge) continue;
        const submission = this.#state.submissions.find(
          (s) => s.judgeId === judge.id && s.projectId === binding.projectId,
        );
        if (!submission) continue;

        let nonce = generateNonce();
        let value = submission.scoreStroops;
        if (fixture) {
          const stored = fixture.fixtureBid(binding.roundId, bidder);
          if (!stored) throw new Error(`missing fixture bid for ${bidder}`);
          nonce = stored.nonce;
          value = stored.scoreStroops;
        }

        await client.reveal({
          roundId: binding.roundId,
          bidder,
          value,
          nonce,
        });

        revealed.push({
          judgeId: judge.id,
          projectId: binding.projectId,
          roundId: binding.roundId,
          scoreStroops: value,
          displayScore: stroopsToDisplayScore(value),
        });
      }
    }

    this.#state = { ...this.#state, phase: "revealing", revealed };
    return revealed;
  }

  /** Step 5 — settle escrows and produce ranked output + organizer receipt. */
  async finalizeRankings(
    client: Pick<
      SubRosaClient,
      "settle" | "getRound" | "getBidders"
    > = this.#requireClient(),
  ): Promise<GrantPilotReceipt> {
    for (const binding of this.#state.roundBindings) {
      await client.settle(binding.roundId);
    }

    const rankings = rankProjects(this.program.projects, this.#state.revealed);
    const roundSnapshots = await Promise.all(
      this.#state.roundBindings.map(async (binding) => {
        const round = await client.getRound(binding.roundId);
        const bidders = await client.getBidders(binding.roundId);
        let revealedCount = 0;
        if (this.#fixtureClient) {
          revealedCount = bidders.filter((bidder) => {
            const bid = this.#fixtureClient!.fixtureBid(binding.roundId, bidder);
            return bid?.revealed ?? false;
          }).length;
        } else {
          revealedCount = this.#state.revealed.filter(
            (r) => r.projectId === binding.projectId,
          ).length;
        }
        return {
          projectId: binding.projectId,
          roundId: binding.roundId,
          status: round.status.tag,
          bidderCount: bidders.length,
          revealedCount,
        };
      }),
    );

    const receipt = buildGrantReceipt({
      program: this.program,
      roundSnapshots,
      rankings,
    });
    this.#state = { ...this.#state, phase: "ranked", receipt };
    return receipt;
  }

  /** Run the full fixture lifecycle end-to-end (no live credentials). */
  async runFixtureLifecycle(): Promise<GrantPilotReceipt> {
    await this.createProjectRounds();
    await this.submitAllFixtureScores();
    await this.openAllReveals();
    await this.revealAllScores();
    return this.finalizeRankings();
  }

  /** Live pilot path — create rounds on a real SubRosaClient. */
  async createLiveProjectRounds(client: SubRosaClient): Promise<RoundBinding[]> {
    const bindings: RoundBinding[] = [];
    for (const project of this.program.projects) {
      const roundId = await createProjectRound({
        client,
        program: this.program,
        project,
        auditorPubkey: this.auditor.publicKey,
      });
      bindings.push({ projectId: project.id, roundId });
    }
    this.#state = { ...this.#state, phase: "accepting-scores", roundBindings: bindings };
    return bindings;
  }

  #requireClient(): FixtureGrantClient {
    if (!this.#fixtureClient) {
      throw new Error("live client operations require an explicit SubRosaClient");
    }
    return this.#fixtureClient;
  }
}
