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
  /** Expected appraisal payment asset (SEP-41 C...). Binds quote asset to mandate. */
  appraisalAsset?: string;
  /** Expected appraisal payment destination (payTo G...). Binds quote payTo. */
  appraisalPayTo?: string;
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

/** Typed refusal for a drifted/unsafe appraisal quote — safe to show in traces. */
export type AppraisalQuoteRefusalCode =
  | "QUOTE_EXCEEDS_CAP"
  | "QUOTE_SPEND_EXCEEDED"
  | "QUOTE_ASSET_MISMATCH"
  | "QUOTE_DESTINATION_MISMATCH"
  | "QUOTE_EXPIRED"
  | "QUOTE_INVALID"
  | "QUOTE_BODY_EMPTY"
  | "QUOTE_BODY_OVERSIZED"
  | "QUOTE_BODY_CREDENTIALS";

export interface AppraisalQuoteRefusalTrace {
  type: "appraisal-quote-refusal";
  code: AppraisalQuoteRefusalCode;
  message: string;
}

export class AppraisalQuoteRefusalError extends MandateCapError {
  readonly code: AppraisalQuoteRefusalCode;

  constructor(code: AppraisalQuoteRefusalCode, message: string) {
    super(message);
    this.name = "AppraisalQuoteRefusalError";
    this.code = code;
  }

  /** Serializable record the keeper / demo trace can render. */
  toTraceRecord(): AppraisalQuoteRefusalTrace {
    return {
      type: "appraisal-quote-refusal",
      code: this.code,
      message: this.message,
    };
  }
}

/** Payment quote the agent must bind to the mandate before any transfer. */
export interface MandateAppraisalQuote {
  /** Expected SEP-41 token contract (C...). */
  asset: string;
  /** Quoted price in stroops (bigint or integer string). */
  amount: bigint | string;
  /** Expected destination (payTo) receiving the appraisal payment. */
  destination: string;
  /** Unix seconds after which the quote must no longer be paid. */
  expiresAt: number;
}

/** Max appraisal request body the agent will ever pay for (bytes). */
export const MAX_APPRAISAL_BODY_BYTES = 8192;

const CREDENTIAL_LIKE_KEY = /(secret|password|passwd|token|authorization|private[\-_]?key|api[\-_]?key|seed|mnemonic)/i;

function scanCredentialKeys(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => scanCredentialKeys(v, depth + 1));
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (CREDENTIAL_LIKE_KEY.test(key)) return true;
    if (scanCredentialKeys((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Refuse an appraisal request body that is empty, oversized, or carries
 * credential-like fields. Throws AppraisalQuoteRefusalError — callers must not
 * submit any payment when this throws.
 */
export function assertAppraisalRequestBodyAllowed(body: string | Uint8Array | Buffer | undefined | null): void {
  const len =
    body == null ? 0 : typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.length;
  if (len === 0 || (typeof body === "string" && body.trim().length === 0)) {
    throw new AppraisalQuoteRefusalError("QUOTE_BODY_EMPTY", "appraisal body must not be empty");
  }
  if (len > MAX_APPRAISAL_BODY_BYTES) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_BODY_OVERSIZED",
      `appraisal body exceeds ${MAX_APPRAISAL_BODY_BYTES} bytes`,
    );
  }
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (scanCredentialKeys(parsed)) {
        throw new AppraisalQuoteRefusalError(
          "QUOTE_BODY_CREDENTIALS",
          "appraisal body must not contain credential-like fields",
        );
      }
    } catch (e) {
      if (e instanceof AppraisalQuoteRefusalError) throw e;
      // Non-JSON bodies are rejected downstream with a stable error; the
      // credential scan only applies to parseable JSON.
    }
  }
}

function invalidNumericField(field: string): never {
  throw new MandateError(`invalid mandate ${field}`);
}

function assertSafeMandateInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) invalidNumericField(field);
}

function assertMandateIntegerString(value: string, field: string, minimum = 0n): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) invalidNumericField(field);
  const parsed = BigInt(value);
  if (parsed < minimum) invalidNumericField(field);
}

function validateMandateNumbers(payload: SessionMandatePayload): void {
  assertSafeMandateInteger(payload.basePriceUsdc, "basePriceUsdc");
  assertSafeMandateInteger(payload.commitDeadline, "commitDeadline");
  assertSafeMandateInteger(payload.issuedAt, "issuedAt");
  assertSafeMandateInteger(payload.expiresAt, "expiresAt");
  assertMandateIntegerString(payload.roundId, "roundId", 1n);
  assertMandateIntegerString(payload.maxBidStroops, "maxBidStroops");
  assertMandateIntegerString(payload.maxEscrowStroops, "maxEscrowStroops");
  assertMandateIntegerString(payload.maxAppraisalSpendStroops, "maxAppraisalSpendStroops");
  assertMandateIntegerString(payload.appraisalPriceStroops, "appraisalPriceStroops");
  if (payload.appraisalAsset !== undefined) {
    if (typeof payload.appraisalAsset !== "string" || payload.appraisalAsset.trim() === "") {
      throw new MandateError("invalid mandate appraisalAsset");
    }
  }
  if (payload.appraisalPayTo !== undefined) {
    if (typeof payload.appraisalPayTo !== "string" || payload.appraisalPayTo.trim() === "") {
      throw new MandateError("invalid mandate appraisalPayTo");
    }
  }
}

function validateMandateTimestampOrdering(payload: SessionMandatePayload): void {
  if (payload.issuedAt > payload.expiresAt) {
    throw new MandateError("issuedAt must be <= expiresAt");
  }
  if (payload.issuedAt > payload.commitDeadline) {
    throw new MandateError("issuedAt must be <= commitDeadline");
  }
  if (payload.commitDeadline > payload.expiresAt) {
    throw new MandateError("commitDeadline must be <= expiresAt");
  }
}

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
  if (!Number.isFinite(amount)) {
    throw new MandateError(`usdc amount must be a finite number, got ${amount}`);
  }
  if (amount < 0) {
    throw new MandateError(`usdc amount must be non-negative, got ${amount}`);
  }
  const scaled = Math.round(amount * 1e7);
  if (!Number.isSafeInteger(scaled)) {
    throw new MandateError(`usdc amount ${amount} is out of stroop-safe range`);
  }
  return BigInt(scaled);
}

export function stroopsToUsdc(stroops: bigint): number {
  if (typeof stroops !== "bigint") {
    throw new MandateError(`stroops must be a bigint, got ${typeof stroops}`);
  }
  if (stroops < 0n) {
    throw new MandateError(`stroops must be non-negative, got ${stroops}`);
  }
  // Split whole/fraction to avoid `Number(bigint)` precision loss for large
  // escrow/bid values that exceed Number's safe integer range.
  const whole = Number(stroops / 10_000_000n);
  const frac = Number(stroops % 10_000_000n) / 1e7;
  return whole + frac;
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
  /** Expected appraisal payment asset (C...). Binds quote asset to the mandate. */
  appraisalAsset?: string;
  /** Expected appraisal payment destination (payTo G...). Binds quote payTo. */
  appraisalPayTo?: string;
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
    appraisalAsset: params.appraisalAsset,
    appraisalPayTo: params.appraisalPayTo,
    commitDeadline: params.commitDeadline,
    issuedAt: now,
    expiresAt: now + (params.ttlSeconds ?? 3600),
  };
  validateMandateNumbers(payload);
  validateMandateTimestampOrdering(payload);
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

  validateMandateNumbers(payload);
  validateMandateTimestampOrdering(payload);

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

function parseQuoteAmountToStroops(amount: MandateAppraisalQuote["amount"]): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be positive");
    }
    return amount;
  }
  if (typeof amount !== "string" || !/^(0|[1-9]\d*)$/.test(amount)) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be a stroops integer string");
  }
  const parsed = BigInt(amount);
  if (parsed <= 0n) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be positive");
  }
  return parsed;
}

/**
 * Bind a payment quote to the signed mandate before any Stellar transfer.
 *
 * Fails closed: amount above the per-call cap, cumulative spend above the
 * session cap, asset/destination mismatch, or an expired quote all throw
 * AppraisalQuoteRefusalError (a MandateCapError). Callers must not submit any
 * payment when this throws; `err.toTraceRecord()` is safe for keeper traces.
 */
export function assertAppraisalQuoteAllowed(
  mandate: SessionMandate,
  quote: MandateAppraisalQuote,
  opts?: {
    spentSoFarStroops?: bigint;
    nowSeconds?: number;
    clock?: import("@sub-rosa/time").Clock;
    /** Fallback when the mandate carries no appraisalAsset (operator config). */
    expectedAsset?: string;
    /** Fallback when the mandate carries no appraisalPayTo (operator config). */
    expectedDestination?: string;
  },
): void {
  if (!quote || typeof quote !== "object") {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote must be an object");
  }
  if (typeof quote.asset !== "string" || quote.asset.trim() === "") {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote asset must be a non-empty string");
  }
  if (typeof quote.destination !== "string" || quote.destination.trim() === "") {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote destination must be a non-empty string");
  }
  if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt < 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote expiresAt must be a safe integer");
  }
  const amount = parseQuoteAmountToStroops(quote.amount);

  const now = opts?.nowSeconds ?? (opts?.clock ?? systemClock).nowSeconds();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote check clock is invalid");
  }
  if (now > quote.expiresAt) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_EXPIRED",
      `appraisal quote expired at ${quote.expiresAt} (now ${now})`,
    );
  }

  const expectedAsset = mandate.appraisalAsset ?? opts?.expectedAsset;
  if (expectedAsset !== undefined && quote.asset !== expectedAsset) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_ASSET_MISMATCH",
      `appraisal quote asset ${quote.asset} does not match mandate ${expectedAsset}`,
    );
  }
  const expectedDestination = mandate.appraisalPayTo ?? opts?.expectedDestination;
  if (expectedDestination !== undefined && quote.destination !== expectedDestination) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_DESTINATION_MISMATCH",
      `appraisal quote destination ${quote.destination} does not match mandate ${expectedDestination}`,
    );
  }

  if (amount > BigInt(mandate.appraisalPriceStroops)) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_EXCEEDS_CAP",
      `appraisal quote ${amount} exceeds mandate cap ${mandate.appraisalPriceStroops}`,
    );
  }
  const spent = opts?.spentSoFarStroops ?? 0n;
  if (typeof spent !== "bigint" || spent < 0n) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "spentSoFarStroops must be a non-negative bigint");
  }
  if (spent + amount > BigInt(mandate.maxAppraisalSpendStroops)) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_SPEND_EXCEEDED",
      `appraisal spend ${spent + amount} would exceed mandate cap ${mandate.maxAppraisalSpendStroops}`,
    );
  }
}

/** Remaining x402 appraisal budget (stroops) before the mandate cap is hit. */
export function remainingAppraisalSpend(
  mandate: SessionMandate,
  spentSoFarStroops: bigint = 0n,
): bigint {
  if (typeof spentSoFarStroops !== "bigint" || spentSoFarStroops < 0n) {
    throw new MandateError(
      `spentSoFarStroops must be a non-negative bigint, got ${String(spentSoFarStroops)}`,
    );
  }
  const cap = BigInt(mandate.maxAppraisalSpendStroops);
  const remaining = cap - spentSoFarStroops;
  if (remaining < 0n) {
    throw new MandateCapError(
      `appraisal spend ${spentSoFarStroops} already exceeds mandate cap ${cap}`,
    );
  }
  return remaining;
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
