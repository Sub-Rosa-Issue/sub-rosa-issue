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
import { SubRosaClient } from "@sub-rosa/sdk";
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

/** Run one autonomous bid: verify mandate → pay appraisal → seal → commit. */
export async function runBidderAgent(config: BidderAgentConfig): Promise<BidderAgentResult> {
  const log = config.log ?? (() => {});
  const roundId = BigInt(config.mandate.roundId);
  const sessionKp = Keypair.fromSecret(config.sessionSecret);
  if (sessionKp.publicKey() !== config.mandate.sessionKey) {
    throw new Error("sessionSecret does not match mandate.sessionKey");
  }

  verifySessionMandate(config.mandate, {
    contractId: config.mandate.contractId,
    roundId,
  });

  const reader = new SubRosaClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.mandate.contractId,
    publicKey: config.mandate.principal,
  });
  const round = await reader.getRound(roundId);
  if (round.status.tag !== "Open") {
    throw new Error(`round ${roundId} is not open for commits (status=${round.status.tag})`);
  }

  const req = appraisalRequest(config.mandate, config.attributes);
  const quotedPrice = BigInt(config.mandate.appraisalPriceStroops);
  assertAppraisalSpendAllowed(config.mandate, quotedPrice, 0n);

  log(`paying appraisal (${stroopsToUsdc(quotedPrice)} USDC)…`);
  const paidFetch = createPaidFetch({
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

  const drand = config.drand ?? quicknet();
  const nonce = generateNonce();
  const sealed = await sealBid({
    value: bidValue,
    nonce,
    round: config.revealRound,
    client: drand,
    identity: new TextEncoder().encode(`agent:${sessionKp.publicKey()}`),
    auditorPublicKey: config.auditorPubkey,
  });

  const bidder = new SubRosaClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.mandate.contractId,
    secretKey: config.sessionSecret,
  });
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
