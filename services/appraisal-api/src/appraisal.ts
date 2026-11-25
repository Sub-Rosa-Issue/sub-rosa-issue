// Copyright (c) 2026 Sub Rosa contributors
// Deterministic appraisal model.
//
// Given a structured item descriptor, produce a fair-value estimate, a
// confidence band, and a suggested maximum bid. The output is a pure,
// reproducible function of the input — no randomness, no hardcoded answer, no
// external oracle. Identical inputs always yield identical numbers, and the
// `inputsHash` lets an agent (or auditor) bind a paid appraisal to the exact
// request that produced it.

import { createHash } from "node:crypto";

export const APPRAISAL_MODEL = "subrosa-appraisal/v1";

/** Safety bounds for free-text fields. Generous, but caps integrator footguns. */
export const MAX_ITEMREF_LENGTH = 256;
export const MAX_CATEGORY_LENGTH = 64;

/** Max raw appraisal request body (bytes). Guards against oversized exfiltration. */
export const MAX_APPRAISAL_BODY_BYTES = 8192;

/** Default quote time-to-live (seconds) when the server mints a payment quote. */
export const APPRAISAL_QUOTE_TTL_SECONDS = 60;

/**
 * Payment quote bound to an appraisal call.
 *
 * The agent must validate this quote against its signed mandate *before* any
 * Stellar transfer: asset + destination must match expectations, amount must be
 * within the mandate cap, and `expiresAt` must still be in the future.
 */
export interface AppraisalQuote {
  /** SEP-41 token contract (C...) the x402 payment settles in. */
  asset: string;
  /** Quoted price in stroops (7-decimal integer, as a string). */
  amount: string;
  /** Destination account/contract (payTo) receiving the appraisal payment. */
  destination: string;
  /** Unix seconds after which the quote must no longer be paid. */
  expiresAt: number;
}

export interface AppraisalAttributes {
  /** Intrinsic quality, 0–100. */
  quality?: number;
  /** Market demand, 0–100. */
  demand?: number;
  /** Scarcity / uniqueness, 0–100. */
  scarcity?: number;
  /** Downside risk, 0–100 (higher risk lowers value). */
  risk?: number;
}

export interface AppraisalRequest {
  /** Opaque item identifier (e.g. a Round `item_ref` hash or an RFP id). */
  itemRef: string;
  /** Anchor price in USDC the model scales around (must be > 0). */
  basePrice: number;
  /** Optional category multiplier key. */
  category?: string;
  attributes?: AppraisalAttributes;
}

export interface Appraisal {
  model: typeof APPRAISAL_MODEL;
  itemRef: string;
  inputsHash: string;
  fairValue: number;
  low: number;
  high: number;
  confidence: number;
  suggestedMaxBid: number;
  rationale: string[];
}

const CATEGORY_MULTIPLIERS: Record<string, number> = {
  grant: 1.0,
  rfp: 1.05,
  bounty: 0.95,
  spectrum: 1.25,
  procurement: 1.1,
  collectible: 1.4,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Stable JSON (sorted keys) so the hash is independent of property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function inputsHash(req: AppraisalRequest): string {
  return createHash("sha256").update(canonical(req)).digest("hex");
}

export class AppraisalInputError extends Error {}

/** Keys that look like credentials — never allowed inside an appraisal body. */
const CREDENTIAL_LIKE_KEY = /(secret|password|passwd|token|authorization|private[\-_]?key|api[\-_]?key|seed|mnemonic)/i;

function assertNoCredentialFieldsDeep(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialFieldsDeep(item, depth + 1);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (CREDENTIAL_LIKE_KEY.test(key)) {
      throw new AppraisalInputError(
        "appraisal body must not contain credential-like fields",
      );
    }
    assertNoCredentialFieldsDeep((value as Record<string, unknown>)[key], depth + 1);
  }
}

/** Refuse empty, oversized, or credential-bearing raw bodies before any payment. */
export function assertAppraisalBodyBytes(raw: Buffer | Uint8Array | string): void {
  const len =
    typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.length;
  if (len === 0) {
    throw new AppraisalInputError("appraisal body must not be empty");
  }
  if (len > MAX_APPRAISAL_BODY_BYTES) {
    throw new AppraisalInputError(
      `appraisal body exceeds ${MAX_APPRAISAL_BODY_BYTES} bytes`,
    );
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new AppraisalInputError("appraisal body must not be empty");
    }
    try {
      assertNoCredentialFieldsDeep(JSON.parse(trimmed));
    } catch (e) {
      if (e instanceof AppraisalInputError) throw e;
      // Non-JSON bodies fail later in parseAppraisalRequest with a stable error;
      // credential scan only applies to parseable JSON.
    }
  }
}

/** Refuse parsed bodies that carry credential-like fields (fail closed). */
export function assertNoCredentialFields(value: unknown): void {
  assertNoCredentialFieldsDeep(value);
}

/** Mint a payment quote for one appraisal call. Pure except for `nowSeconds`. */
export function buildAppraisalQuote(params: {
  asset: string;
  /** Decimal price (e.g. 0.10 USDC). Must be finite and > 0. */
  price: number;
  destination: string;
  nowSeconds: number;
  ttlSeconds?: number;
}): AppraisalQuote {
  const { asset, price, destination, nowSeconds } = params;
  const ttl = params.ttlSeconds ?? APPRAISAL_QUOTE_TTL_SECONDS;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new AppraisalInputError("nowSeconds must be a non-negative safe integer");
  }
  if (typeof asset !== "string" || asset.trim() === "") {
    throw new AppraisalInputError("quote asset must be a non-empty string");
  }
  if (typeof destination !== "string" || destination.trim() === "") {
    throw new AppraisalInputError("quote destination must be a non-empty string");
  }
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new AppraisalInputError("quote price must be a finite number > 0");
  }
  const stroops = Math.round(price * 1e7);
  if (!Number.isSafeInteger(stroops) || stroops <= 0) {
    throw new AppraisalInputError("quote price is out of stroop-safe range");
  }
  return {
    asset,
    amount: String(stroops),
    destination,
    expiresAt: nowSeconds + ttl,
  };
}

/** Validate and normalize a raw request; throws AppraisalInputError on bad input. */
export function parseAppraisalRequest(raw: unknown): AppraisalRequest {
  if (!raw || typeof raw !== "object") {
    throw new AppraisalInputError("body must be a JSON object");
  }
  // Fail closed: credential-like keys anywhere in the body refuse the request
  // before any payment is offered or settled.
  assertNoCredentialFieldsDeep(raw);
  const o = raw as Record<string, unknown>;
  if (typeof o.itemRef !== "string" || o.itemRef.trim() === "") {
    throw new AppraisalInputError("itemRef must be a non-empty string");
  }
  if (o.itemRef.length > MAX_ITEMREF_LENGTH) {
    throw new AppraisalInputError(
      `itemRef must be at most ${MAX_ITEMREF_LENGTH} characters`,
    );
  }
  if (typeof o.basePrice !== "number" || !Number.isFinite(o.basePrice) || o.basePrice <= 0) {
    throw new AppraisalInputError("basePrice must be a finite number > 0");
  }
  if (o.category !== undefined && typeof o.category !== "string") {
    throw new AppraisalInputError("category must be a string");
  }
  if (typeof o.category === "string" && o.category.length > MAX_CATEGORY_LENGTH) {
    throw new AppraisalInputError(
      `category must be at most ${MAX_CATEGORY_LENGTH} characters`,
    );
  }
  const attrs: AppraisalAttributes = {};
  if (o.attributes !== undefined) {
    if (typeof o.attributes !== "object" || o.attributes === null) {
      throw new AppraisalInputError("attributes must be an object");
    }
    const a = o.attributes as Record<string, unknown>;
    for (const key of ["quality", "demand", "scarcity", "risk"] as const) {
      if (a[key] !== undefined) {
        const v = a[key];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new AppraisalInputError(`attributes.${key} must be a number`);
        }
        // Scores are clamped (do not reject) so integrators can submit raw 0–100
        // survey data without coercing it first; only NaN/Infinity propagate
        // invalidly into math and are treated as a validation error.
        attrs[key] = Math.min(100, Math.max(0, v));
      }
    }
  }
  return {
    itemRef: o.itemRef,
    basePrice: o.basePrice,
    category: o.category as string | undefined,
    attributes: attrs,
  };
}

/** The deterministic valuation model. Pure: output depends only on `req`. */
export function appraise(req: AppraisalRequest): Appraisal {
  const a = req.attributes ?? {};
  const quality = (a.quality ?? 50) / 100;
  const demand = (a.demand ?? 50) / 100;
  const scarcity = (a.scarcity ?? 50) / 100;
  const risk = (a.risk ?? 50) / 100;

  const qualityF = 0.5 + quality; // 0.50 .. 1.50
  const demandF = 0.6 + 0.8 * demand; // 0.60 .. 1.40
  const scarcityF = 0.7 + 0.6 * scarcity; // 0.70 .. 1.30
  const riskF = 1 - 0.4 * risk; // 1.00 .. 0.60
  const categoryF = req.category ? (CATEGORY_MULTIPLIERS[req.category] ?? 1.0) : 1.0;

  const fairValue = round2(req.basePrice * qualityF * demandF * scarcityF * riskF * categoryF);

  // Confidence rises with how many attributes the caller actually supplied.
  const provided = (["quality", "demand", "scarcity", "risk"] as const).filter(
    (k) => a[k] !== undefined,
  ).length;
  const confidence = round2(clamp01(0.5 + 0.125 * provided)); // 0.50 .. 1.00

  const band = (1 - confidence) * 0.5; // half-width fraction
  const low = round2(fairValue * (1 - band));
  const high = round2(fairValue * (1 + band));
  // Bid below fair value; lean closer to fair value as confidence grows.
  const suggestedMaxBid = round2(fairValue * (0.8 + 0.15 * confidence));

  const rationale = [
    `base ${req.basePrice} USDC scaled by quality×${round2(qualityF)}, demand×${round2(demandF)}, scarcity×${round2(scarcityF)}, risk×${round2(riskF)}`,
    `category '${req.category ?? "none"}' multiplier ×${categoryF}`,
    `${provided}/4 attributes supplied → confidence ${confidence}`,
    `suggested max bid is fair value × ${round2(0.8 + 0.15 * confidence)} to preserve margin`,
  ];

  return {
    model: APPRAISAL_MODEL,
    itemRef: req.itemRef,
    inputsHash: inputsHash(req),
    fairValue,
    low,
    high,
    confidence,
    suggestedMaxBid,
    rationale,
  };
}
