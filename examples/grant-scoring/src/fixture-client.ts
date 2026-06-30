import type {
  BidState,
  CreateRoundParams,
  Round,
  SubRosaClient,
} from "@sub-rosa/sdk";
import { commitment } from "@sub-rosa/tlock";

import type { SealedScoreSubmission } from "./types.js";

type StoredBid = {
  commitment: Uint8Array;
  ciphertext: Uint8Array;
  auditorBlob: Uint8Array;
  escrow: bigint;
  nonce: Uint8Array;
  scoreStroops: bigint;
  revealed: boolean;
};

type StoredRound = Round & {
  internalId: bigint;
  seals: Map<string, StoredBid>;
};

/**
 * Offline Sub Rosa client for fixture pilots — mirrors SDK commit/reveal flow
 * without RPC credentials. Not used by the jury demo trace.
 */
export class FixtureGrantClient implements Pick<
  SubRosaClient,
  | "createRound"
  | "commit"
  | "getRound"
  | "getBidState"
  | "getBidders"
  | "openReveal"
  | "reveal"
  | "settle"
> {
  readonly contractId: string;
  #nextRoundId = 1n;
  readonly #rounds = new Map<bigint, StoredRound>();
  readonly #roundByProject = new Map<string, bigint>();

  constructor(contractId: string) {
    this.contractId = contractId;
  }

  getRoundIdForProject(projectId: string): bigint | undefined {
    return this.#roundByProject.get(projectId);
  }

  linkProjectRound(projectId: string, roundId: bigint): void {
    this.#roundByProject.set(projectId, roundId);
  }

  async createRound(params: CreateRoundParams): Promise<bigint> {
    const roundId = this.#nextRoundId++;
    const round: StoredRound = {
      internalId: roundId,
      auditor_pubkey: Buffer.from(params.auditorPubkey),
      bidders: [],
      clearing_rule: { tag: params.clearingRule ?? "HighestBid", values: undefined },
      commit_deadline: BigInt(params.commitDeadline),
      item_ref: Buffer.from(params.itemRef),
      operator: params.operator ?? "GOPERATOR",
      reveal_deadline: BigInt(params.revealDeadline),
      reveal_round: BigInt(params.revealRound),
      status: { tag: "Open", values: undefined },
      winner: undefined,
      winning_bid: 0n,
      seals: new Map(),
    };
    this.#rounds.set(roundId, round);
    return roundId;
  }

  async commit(params: {
    roundId: number | bigint;
    sealed: {
      commitment: Uint8Array;
      ciphertext: Uint8Array;
      auditorBlob: Uint8Array;
    };
    escrow: bigint;
    bidder?: string;
  }): Promise<void> {
    const roundId = BigInt(params.roundId);
    const round = this.#requireRound(roundId);
    if (round.status.tag !== "Open") {
      throw new Error(`round ${roundId} is not open`);
    }
    const bidder = params.bidder ?? "GBIDDER";
    if (round.seals.has(bidder)) {
      throw new Error(`bidder ${bidder} already committed`);
    }
    round.seals.set(bidder, {
      commitment: params.sealed.commitment,
      ciphertext: params.sealed.ciphertext,
      auditorBlob: params.sealed.auditorBlob,
      escrow: params.escrow,
      nonce: new Uint8Array(32),
      scoreStroops: 0n,
      revealed: false,
    });
    round.bidders = [...round.bidders, bidder].sort();
  }

  registerFixtureSubmission(
    submission: SealedScoreSubmission,
    bidder: string,
    nonce: Uint8Array,
  ): void {
    const round = this.#requireRound(submission.roundId);
    const stored = round.seals.get(bidder);
    if (!stored) throw new Error(`no commit for ${bidder} on round ${submission.roundId}`);
    stored.scoreStroops = submission.scoreStroops;
    stored.nonce = nonce;
    stored.commitment = commitment(submission.scoreStroops, nonce);
  }

  async getRound(roundId: number | bigint): Promise<Round> {
    return this.#publicRound(this.#requireRound(BigInt(roundId)));
  }

  async getBidState(roundId: number | bigint, bidder: string): Promise<BidState> {
    const round = this.#requireRound(BigInt(roundId));
    const stored = round.seals.get(bidder);
    if (!stored) {
      throw new Error(`unknown bidder ${bidder}`);
    }
    return {
      commitment: Buffer.from(stored.commitment),
      escrow: stored.escrow,
      revealed_value: stored.revealed ? stored.scoreStroops : undefined,
      settled: round.status.tag === "Settled",
      valid: stored.revealed,
    };
  }

  async getBidders(roundId: number | bigint): Promise<string[]> {
    return [...this.#requireRound(BigInt(roundId)).bidders];
  }

  async openReveal(roundId: number | bigint, _drandSignature: Uint8Array): Promise<void> {
    const round = this.#requireRound(BigInt(roundId));
    if (round.status.tag === "Revealing") return;
    if (round.status.tag !== "Open") {
      throw new Error(`round ${roundId} cannot open reveal from ${round.status.tag}`);
    }
    round.status = { tag: "Revealing", values: undefined };
  }

  async reveal(params: {
    roundId: number | bigint;
    bidder: string;
    value: bigint;
    nonce: Uint8Array;
  }): Promise<void> {
    const round = this.#requireRound(BigInt(params.roundId));
    const stored = round.seals.get(params.bidder);
    if (!stored) throw new Error(`unknown bidder ${params.bidder}`);
    if (stored.revealed) return;
    const expected = commitment(params.value, params.nonce);
    if (Buffer.from(expected).compare(Buffer.from(stored.commitment)) !== 0) {
      throw new Error("commitment mismatch at reveal");
    }
    stored.scoreStroops = params.value;
    stored.nonce = params.nonce;
    stored.revealed = true;
  }

  async settle(roundId: number | bigint): Promise<void> {
    const round = this.#requireRound(BigInt(roundId));
    round.status = { tag: "Settled", values: undefined };
  }

  #requireRound(roundId: bigint): StoredRound {
    const round = this.#rounds.get(roundId);
    if (!round) throw new Error(`unknown round ${roundId}`);
    return round;
  }

  #publicRound(round: StoredRound): Round {
    const { seals: _seals, internalId: _id, ...rest } = round;
    return rest;
  }

  fixtureBid(roundId: bigint, bidder: string): StoredBid | undefined {
    return this.#rounds.get(roundId)?.seals.get(bidder);
  }
}
