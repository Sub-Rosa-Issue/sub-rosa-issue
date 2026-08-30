// Copyright (c) 2026 Sub Rosa contributors
// Session mandate — scoped authorization for an autonomous bidder agent.
//
// A human/principal wallet signs a mandate that binds a session public key to a
// single round with explicit caps (max bid, max escrow, max appraisal spend).
// The agent verifies the signature before every action and refuses to exceed
// any cap. On-chain, `commit(escrow=…)` is the public escrow ceiling and the
// contract rejects reveals where `value > escrow` — so the mandate caps are
// enforced off-chain by the agent and on-chain by the Round contract.

import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import { systemClock } from "@sub-rosa/time";

export const MANDATE_VERSION = 1;

export interface SessionMandatePayload {
  version: typeof MANDATE_VERSION;
  /** Master account (G…) that signed this mandate. */
  principal: string;
  /** Session public key (G…) the agent uses to sign commits and x402 payments. */
  sessionKey: string;
  contractId: string;
  roundId: string;
  /** Must match the round's item_ref / appraisal itemRef. */
  itemRef: string;
  /** Anchor price passed to the appraisal API (whole USDC). */
  basePriceUsdc: number;
  category?: string;
  /** Maximum sealed bid value (7-decimal token units / stroops). */
  maxBidStroops: string;
  /** Maximum USDC locked at commit (stroops). */
  maxEscrowStroops: string;
  /** Maximum total x402 appraisal spend for this session (stroops). */
  maxAppraisalSpendStroops: string;
  /** Expected per-call appraisal price (stroops); agent refuses if server asks more. */
  appraisalPriceStroops: string;
  commitDeadline: number;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionMandate extends SessionMandatePayload {
  /** Base64 Ed25519 signature over the canonical payload bytes by `principal`. */
  signature: string;
}

export class MandateError extends Error {}
export class MandateCapError extends MandateError {}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

/** Bytes the principal signs — everything except `signature`. */
export function mandateDigest(payload: SessionMandatePayload): Buffer {
  return createHash("sha256").update(canonical(payload)).digest();
}

export function usdcToStroops(amount: number): bigint {
  return BigInt(Math.round(amount * 1e7));
}

export function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / 1e7;
}

export interface CreateMandateParams {
  principalSecret: string;
  contractId: string;
  roundId: bigint | number;
  itemRef: string;
  basePriceUsdc: number;
  category?: string;
  maxBidStroops: bigint;
  maxEscrowStroops: bigint;
  maxAppraisalSpendStroops: bigint;
  appraisalPriceStroops: bigint;
  commitDeadline: number;
  /** Mandate validity window (seconds from now). Default 3600. */
  ttlSeconds?: number;
  /** Optional pre-generated session secret; otherwise a fresh keypair is created. */
  sessionSecret?: string;
  /** Injectable wall clock. Default: systemClock. */
  clock?: import("@sub-rosa/time").Clock;
}

/** Issue a fresh session key + principal-signed mandate. */
export function createSessionMandate(params: CreateMandateParams): {
  mandate: SessionMandate;
  sessionSecret: string;
} {
  const principal = Keypair.fromSecret(params.principalSecret);
  const session = params.sessionSecret
    ? Keypair.fromSecret(params.sessionSecret)
    : Keypair.random();
  const clock = params.clock ?? systemClock;
  const now = clock.nowSeconds();
  const payload: SessionMandatePayload = {
    version: MANDATE_VERSION,
    principal: principal.publicKey(),
    sessionKey: session.publicKey(),
    contractId: params.contractId,
    roundId: String(params.roundId),
    itemRef: params.itemRef,
    basePriceUsdc: params.basePriceUsdc,
    category: params.category,
    maxBidStroops: String(params.maxBidStroops),
    maxEscrowStroops: String(params.maxEscrowStroops),
    maxAppraisalSpendStroops: String(params.maxAppraisalSpendStroops),
    appraisalPriceStroops: String(params.appraisalPriceStroops),
    commitDeadline: params.commitDeadline,
    issuedAt: now,
    expiresAt: now + (params.ttlSeconds ?? 3600),
  };
  const sig = principal.sign(mandateDigest(payload));
  return {
    mandate: { ...payload, signature: sig.toString("base64") },
    sessionSecret: session.secret(),
  };
}

/** Verify principal signature, expiry, and round binding. */
export function verifySessionMandate(
  mandate: SessionMandate,
  opts?: { contractId?: string; roundId?: bigint | number; now?: number; clock?: import("@sub-rosa/time").Clock },
): void {
  if (mandate.version !== MANDATE_VERSION) {
    throw new MandateError(`unsupported mandate version ${mandate.version}`);
  }
  const { signature, ...payload } = mandate;
  const digest = mandateDigest(payload);
  const ok = Keypair.fromPublicKey(mandate.principal).verify(
    digest,
    Buffer.from(signature, "base64"),
  );
  if (!ok) throw new MandateError("invalid mandate signature");

  const now = opts?.now ?? (opts?.clock ?? systemClock).nowSeconds();
  if (now > mandate.expiresAt) throw new MandateError("mandate expired");
  if (now > mandate.commitDeadline) throw new MandateError("commit deadline passed");

  if (opts?.contractId && mandate.contractId !== opts.contractId) {
    throw new MandateError("mandate contractId mismatch");
  }
  if (opts?.roundId !== undefined && mandate.roundId !== String(opts.roundId)) {
    throw new MandateError("mandate roundId mismatch");
  }

  if (BigInt(mandate.maxBidStroops) > BigInt(mandate.maxEscrowStroops)) {
    throw new MandateError("maxBidStroops cannot exceed maxEscrowStroops");
  }
  if (BigInt(mandate.appraisalPriceStroops) > BigInt(mandate.maxAppraisalSpendStroops)) {
    throw new MandateError("appraisal price exceeds maxAppraisalSpend");
  }
}

/** Refuse an appraisal charge that exceeds the mandate or cumulative spend. */
export function assertAppraisalSpendAllowed(
  mandate: SessionMandate,
  quotedPriceStroops: bigint,
  spentSoFarStroops = 0n,
): void {
  if (quotedPriceStroops > BigInt(mandate.appraisalPriceStroops)) {
    throw new MandateCapError(
      `appraisal price ${quotedPriceStroops} exceeds mandate cap ${mandate.appraisalPriceStroops}`,
    );
  }
  const next = spentSoFarStroops + quotedPriceStroops;
  if (next > BigInt(mandate.maxAppraisalSpendStroops)) {
    throw new MandateCapError(
      `appraisal spend ${next} would exceed mandate cap ${mandate.maxAppraisalSpendStroops}`,
    );
  }
}

/** Refuse a bid/escrow pair that exceeds mandate caps (agent-side guard). */
export function assertBidWithinMandate(
  mandate: SessionMandate,
  bidValue: bigint,
  escrow: bigint,
): void {
  if (bidValue <= 0n) throw new MandateCapError("bid must be positive");
  if (bidValue > BigInt(mandate.maxBidStroops)) {
    throw new MandateCapError(`bid ${bidValue} exceeds mandate maxBid ${mandate.maxBidStroops}`);
  }
  if (escrow <= 0n) throw new MandateCapError("escrow must be positive");
  if (escrow > BigInt(mandate.maxEscrowStroops)) {
    throw new MandateCapError(`escrow ${escrow} exceeds mandate maxEscrow ${mandate.maxEscrowStroops}`);
  }
  if (bidValue > escrow) {
    throw new MandateCapError(`bid ${bidValue} exceeds escrow ${escrow} (on-chain cap)`);
  }
}

/** Size bid + escrow from a paid appraisal, clamped to the mandate. */
export function bidFromAppraisal(
  suggestedMaxBidUsdc: number,
  mandate: SessionMandate,
): { bidValue: bigint; escrow: bigint } {
  let bidValue = usdcToStroops(suggestedMaxBidUsdc);
  const maxBid = BigInt(mandate.maxBidStroops);
  const maxEscrow = BigInt(mandate.maxEscrowStroops);
  if (bidValue > maxBid) bidValue = maxBid;
  assertBidWithinMandate(mandate, bidValue, bidValue <= maxEscrow ? bidValue : maxEscrow);
  const escrow = bidValue; // minimal escrow; contract refunds surplus at settle
  assertBidWithinMandate(mandate, bidValue, escrow);
  return { bidValue, escrow };
}
