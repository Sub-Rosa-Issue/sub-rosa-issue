// Copyright (c) 2026 Sub Rosa contributors
// Autonomous bidder agent — appraisal (x402) → seal → commit.
//
// The agent never uses the principal key on-chain. It verifies its session
// mandate, pays for an appraisal, sizes a bid within the mandate caps, seals
// with tlock, and commits via the SDK using the session secret.

import { Keypair } from "@stellar/stellar-sdk";
import type { Network, SettleResponse } from "@x402/core/types";
import type { Appraisal, AppraisalAttributes, AppraisalRequest } from "@sub-rosa/appraisal-api";
import { createPaidFetch } from "@sub-rosa/appraisal-api";
import { systemClock, type Clock } from "@sub-rosa/time";
import { SubRosaClient, type Round } from "@sub-rosa/sdk";
import {
  generateNonce,
  quicknet,
  sealBid,
  type DrandClient,
} from "@sub-rosa/tlock";

import {
  assertAppraisalSpendAllowed,
  assertBidWithinMandate,
  bidFromAppraisal,
  stroopsToUsdc,
  verifySessionMandate,
  type SessionMandate,
} from "./mandate.js";

export interface BidderAgentConfig {
  mandate: SessionMandate;
  sessionSecret: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** Full URL to POST /appraise (x402-gated). */
  appraisalUrl: string;
  /** Auditor pubkey (96-byte Soroban G2) all bids in the round seal to. */
  auditorPubkey: Uint8Array;
  /** Drand quicknet round R for this auction. */
  revealRound: number;
  /** Appraisal attributes — each agent can supply its own private view. */
  attributes: AppraisalAttributes;
  x402Network?: Network;
  drand?: DrandClient;
  log?: (msg: string) => void;
  clock?: Clock;
}

export interface BidderAgentResult {
  bidder: string;
  bidValue: bigint;
  escrow: bigint;
  auditorBlob: Uint8Array;
  appraisal: Appraisal;
  appraisalSettlement?: SettleResponse;
  inputsHash: string;
}

function appraisalRequest(mandate: SessionMandate, attributes: AppraisalAttributes): AppraisalRequest {
  return {
    itemRef: mandate.itemRef,
    basePrice: mandate.basePriceUsdc,
    category: mandate.category,
    attributes,
  };
}

export interface BidderDependencies {
  createClient: (options: ConstructorParameters<typeof SubRosaClient>[0]) => Pick<SubRosaClient, "getRound" | "commit">;
  createPaidFetch: typeof createPaidFetch;
  sealBid: typeof sealBid;
}

const defaultDependencies: BidderDependencies = {
  createClient: (options) => new SubRosaClient(options),
  createPaidFetch,
  sealBid,
};

function assertCommitEligible(round: Round, roundId: bigint, clock: Clock): void {
  if (round.status.tag !== "Open") {
    throw new Error(`round ${roundId} is not open for commits (status=${round.status.tag})`);
  }
  const now = clock.nowSeconds();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid commit eligibility clock");
  if (BigInt(now) >= round.commit_deadline) {
    throw new Error(`round ${roundId} commit deadline has passed`);
  }
}

/** Run one autonomous bid: verify mandate → pay appraisal → seal → commit. */
export async function runBidderAgent(config: BidderAgentConfig, dependencies: BidderDependencies = defaultDependencies): Promise<BidderAgentResult> {
  const clock = config.clock ?? systemClock;
  const log = config.log ?? (() => {});
  const roundId = BigInt(config.mandate.roundId);
  const sessionKp = Keypair.fromSecret(config.sessionSecret);
  if (sessionKp.publicKey() !== config.mandate.sessionKey) {
    throw new Error("sessionSecret does not match mandate.sessionKey");
  }

  verifySessionMandate(config.mandate, {
    contractId: config.mandate.contractId,
    roundId,
    clock,
  });

  const reader = dependencies.createClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.mandate.contractId,
    publicKey: config.mandate.principal,
  });
  const round = await reader.getRound(roundId);
  assertCommitEligible(round, roundId, clock);
  if (!Number.isSafeInteger(config.revealRound) || config.revealRound < 1 ||
      round.reveal_round < 1n || round.reveal_round > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("reveal round must be a positive safe integer for tlock");
  }
  if (BigInt(config.revealRound) !== round.reveal_round) {
    throw new Error("reveal round mismatch with authoritative round");
  }
  if (config.auditorPubkey.length !== round.auditor_pubkey.length ||
      !config.auditorPubkey.every((byte, index) => byte === round.auditor_pubkey[index])) {
    throw new Error("auditor public key mismatch with authoritative round");
  }
  const revealRound = Number(round.reveal_round);
  const auditorPublicKey = new Uint8Array(round.auditor_pubkey);

  const req = appraisalRequest(config.mandate, config.attributes);
  const quotedPrice = BigInt(config.mandate.appraisalPriceStroops);
  assertAppraisalSpendAllowed(config.mandate, quotedPrice, 0n);

  log(`paying appraisal (${stroopsToUsdc(quotedPrice)} USDC)…`);
  const paidFetch = dependencies.createPaidFetch({
    secret: config.sessionSecret,
    network: config.x402Network ?? "stellar:testnet",
    rpcUrl: config.rpcUrl,
  });
  const paid = await paidFetch<{ appraisal: Appraisal }>(config.appraisalUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (paid.status !== 200 || !paid.body.appraisal) {
    throw new Error(`appraisal failed: ${JSON.stringify(paid.body)}`);
  }
  const appraisal = paid.body.appraisal;
  if (appraisal.itemRef !== config.mandate.itemRef) {
    throw new Error("appraisal itemRef mismatch");
  }

  const { bidValue, escrow } = bidFromAppraisal(appraisal.suggestedMaxBid, config.mandate);
  assertBidWithinMandate(config.mandate, bidValue, escrow);
  log(`appraisal → bid ${stroopsToUsdc(bidValue)} USDC (escrow ${stroopsToUsdc(escrow)})`);

  assertCommitEligible(await reader.getRound(roundId), roundId, clock);
  const drand = config.drand ?? quicknet();
  const nonce = generateNonce();
  const sealed = await dependencies.sealBid({
    value: bidValue,
    nonce,
    round: revealRound,
    client: drand,
    identity: new TextEncoder().encode(`agent:${sessionKp.publicKey()}`),
    auditorPublicKey,
  });

  const bidder = dependencies.createClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.mandate.contractId,
    secretKey: config.sessionSecret,
  });
  // Sealing and simulation may consume the remaining window; the contract is final authority.
  assertCommitEligible(await reader.getRound(roundId), roundId, clock);
  verifySessionMandate(config.mandate, { clock, roundId, contractId: config.mandate.contractId });
  await bidder.commit({ roundId, sealed, escrow });
  log(`committed sealed bid for round ${roundId}`);

  return {
    bidder: sessionKp.publicKey(),
    bidValue,
    escrow,
    auditorBlob: sealed.auditorBlob,
    appraisal,
    appraisalSettlement: paid.settlement,
    inputsHash: appraisal.inputsHash,
  };
}
