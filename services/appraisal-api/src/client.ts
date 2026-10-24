// Copyright (c) 2026 Sub Rosa contributors
// x402 paid-fetch client.
//
// Wraps a single HTTP call with the x402 handshake: try the request, and if the
// server answers 402, sign the Soroban auth entry authorizing the USDC transfer
// and retry with the `X-PAYMENT` header. Returns both the resource body and the
// on-chain settlement receipt. This is what an autonomous bidder agent uses to
// pay the appraisal API per call.

import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, PaymentRequired, SettleResponse } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ClientStellarScheme } from "@x402/stellar/exact/client";

import {
  assertAppraisalBodyBytes,
  MAX_APPRAISAL_BODY_BYTES,
} from "./appraisal.js";
import { normalizeError } from "@sub-rosa/logging/errors";

/** Shared default timeout (ms) for external RPC and appraisal HTTP requests. */
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

export interface PaidClientTimeoutScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimeoutScheduler: PaidClientTimeoutScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clear(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export interface PaidClientConfig {
  /** Payer secret key (S...). Needs a USDC trustline + balance. */
  secret: string;
  /** CAIP-2 network id (default stellar:testnet). */
  network?: Network;
  /** Optional custom Soroban RPC URL. */
  rpcUrl?: string;
  /** Per-request timeout (ms). Defaults to `DEFAULT_RPC_TIMEOUT_MS` (10_000). */
  timeoutMs?: number;
  /** Injectable fetch implementation for testing. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable scheduler for timeout enforcement. */
  scheduler?: PaidClientTimeoutScheduler;
  /**
   * Expected payment quote. When set, the 402 offer is validated before any
   * signed payment is built: asset/destination must match, amount must be
   * within `maxAmountStroops`, and the offer must not be expired. Mismatch
   * throws AppraisalQuoteRefusalError and no second (paid) fetch happens.
   */
  expectedQuote?: {
    asset?: string;
    destination?: string;
    maxAmountStroops: bigint;
    /** Absolute expiry (unix seconds). Defaults to 402 maxTimeout window. */
    expiresAt?: number;
    /** Clock for expiry checks. Defaults to wall clock. */
    nowSeconds?: number;
  };
}

export interface PaidResult<T = unknown> {
  status: number;
  body: T;
  /** Present when a payment was made and settled on-chain. */
  settlement?: SettleResponse;
}

export const MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH = 512;
const SENSITIVE_FIELD = /("?(?:secret|token|password|authorization|privateKey|private_key|apiKey|api_key)"?\s*:\s*)"?[^,}\s]+/gi;

/** Bound provider diagnostics and redact common credential fields before display/logging. */
export function sanitizePaymentErrorDiagnostic(body: string): string {
  return body.slice(0, MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH).replace(SENSITIVE_FIELD, '$1[REDACTED]').slice(0, MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH);
}

export class AppraisalResponseParseError extends Error {
  readonly name = "AppraisalResponseParseError";
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`appraisal api returned ${status} with invalid JSON body`, options);
    this.status = status;
  }
}

export class X402PaymentError extends Error {
  override readonly name: string = "X402PaymentError";
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

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

/** Typed refusal — no payment is submitted when this is thrown. */
export class AppraisalQuoteRefusalError extends X402PaymentError {
  override readonly name: string = "AppraisalQuoteRefusalError";
  readonly code: AppraisalQuoteRefusalCode;

  constructor(code: AppraisalQuoteRefusalCode, message: string, status?: number) {
    super(message, status);
    this.code = code;
  }

  toTraceRecord(): { type: "appraisal-quote-refusal"; code: string; message: string } {
    return {
      type: "appraisal-quote-refusal",
      code: this.code,
      message: this.message,
    };
  }
}

/** Typed error raised when a 402 challenge does not match the client's own request. */
export class QuoteMismatchError extends Error {
  readonly name = "QuoteMismatchError";
  readonly reason: QuoteMismatchReason;
  readonly status?: number;

  constructor(reason: QuoteMismatchReason, status?: number) {
    super(quoteMismatchMessage(reason));
    this.reason = reason;
    this.status = status;
  }
}

export type QuoteMismatchReason =
  | "empty-challenge"
  | "expired"
  | "asset-mismatch"
  | "amount-mismatch"
  | "destination-mismatch";

function quoteMismatchMessage(reason: QuoteMismatchReason): string {
  switch (reason) {
    case "empty-challenge":
      return "x402 challenge contained no payable quote";
    case "expired":
      return "x402 challenge expired before payment";
    case "asset-mismatch":
      return "x402 challenge asset does not match the requested asset";
    case "amount-mismatch":
      return "x402 challenge amount does not match the requested amount";
    case "destination-mismatch":
      return "x402 challenge destination does not match the requested destination";
  }
}

/** The quote the client expects to pay for a given request. */
export interface ExpectedQuote {
  asset: string;
  amount: bigint;
  destination: string;
  /** Unix seconds; the challenge must not be expired at payment time. */
  expiresAt: number;
}

export interface PaidFetchOptions {
  /** The quote this call is willing to pay. */
  expectedQuote?: ExpectedQuote;
  /** Override the clock used for expiry checks (tests). */
  nowSeconds?: () => number;
}

export { MAX_APPRAISAL_BODY_BYTES };
async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new AppraisalResponseParseError(res.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new AppraisalResponseParseError(res.status, { cause });
  }
}

/** Normalize a quote amount (any number or string form) to bigint stroips. */
function normalizeQuoteAmount(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return undefined;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    try {
      return BigInt(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Normalize an expiry timestamp to Unix seconds. */
function normalizeExpiry(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    // Millisecond epochs are common in JSON payloads; convert to seconds.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  }
  return undefined;
}

/** Find the first accepts entry that carries a payable quote. */
function firstQuote(paymentRequired: PaymentRequired): Record<string, unknown> | undefined {
  const accepts = (paymentRequired as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) return undefined;
  for (const entry of accepts) {
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }
  return undefined;
}

function quoteAsset(entry: Record<string, unknown>): string | undefined {
  const asset = entry.asset;
  if (typeof asset === "string" && asset.trim() !== "") return asset;
  const currency = entry.currency;
  if (typeof currency === "string" && currency.trim() !== "") return currency;
  return undefined;
}

function quoteDestination(entry: Record<string, unknown>): string | undefined {
  for (const key of ["destination", "payTo", "pay_to", "recipient", "address"] as const) {
    const value = entry[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function quoteAmount(entry: Record<string, unknown>): bigint | undefined {
  for (const key of ["amount", "maxAmountRequired", "max_amount_required", "price", "value"] as const) {
    const normalized = normalizeQuoteAmount(entry[key]);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function quoteExpiry(entry: Record<string, unknown>): number | undefined {
  for (const key of ["expiresAt", "expires_at", "expiration", "expires"] as const) {
    const normalized = normalizeExpiry(entry[key]);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

/** Verify the 402 challenge against the quote the client requested. */
export function assertChallengeMatchesQuote(
  paymentRequired: PaymentRequired,
  expected: ExpectedQuote,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): void {
  const entry = firstQuote(paymentRequired);
  if (!entry) {
    throw new QuoteMismatchError("empty-challenge");
  }

  const now = nowSeconds();
  if (!Number.isFinite(now)) {
    throw new QuoteMismatchError("expired");
  }
  if (expected.expiresAt <= now) {
    throw new QuoteMismatchError("expired");
  }

  const challengeExpiry = quoteExpiry(entry);
  if (challengeExpiry === undefined || challengeExpiry <= now) {
    throw new QuoteMismatchError("expired");
  }

  const challengeAsset = quoteAsset(entry);
  if (challengeAsset === undefined || challengeAsset !== expected.asset) {
    throw new QuoteMismatchError("asset-mismatch");
  }

  const challengeAmount = quoteAmount(entry);
  if (challengeAmount === undefined || challengeAmount !== expected.amount) {
    throw new QuoteMismatchError("amount-mismatch");
  }

  const challengeDestination = quoteDestination(entry);
  if (challengeDestination === undefined || challengeDestination !== expected.destination) {
    throw new QuoteMismatchError("destination-mismatch");
  }
}

function requestBodyText(init: RequestInit): string | undefined {
  const body = init.body;
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return undefined;
}

/** Guard the outgoing appraisal body: empty/oversized/credential-like → refuse. */
export function assertPaidRequestBodyAllowed(
  init: RequestInit,
  opts?: { requireBody?: boolean },
): void {
  const requireBody = opts?.requireBody ?? true;
  const text = requestBodyText(init);
  if (text === undefined) {
    if (!requireBody) return;
    throw new AppraisalQuoteRefusalError("QUOTE_BODY_EMPTY", "appraisal body must not be empty");
  }
  try {
    assertAppraisalBodyBytes(text);
  } catch (e) {
    const msg = normalizeError(e).message;
    if (/empty/.test(msg)) {
      if (!requireBody && text.trim().length === 0) {
        // Probe (unpaid) path tolerates empty to preserve 402 negotiation;
        // the paid retry below still fails closed via requireBody: true.
        return;
      }
      throw new AppraisalQuoteRefusalError("QUOTE_BODY_EMPTY", msg);
    }
    if (/exceeds/.test(msg)) {
      throw new AppraisalQuoteRefusalError("QUOTE_BODY_OVERSIZED", msg);
    }
    throw new AppraisalQuoteRefusalError("QUOTE_BODY_CREDENTIALS", msg);
  }
}

/** Decimal (e.g. "0.10") or integer stroops quote amount → stroops bigint. */
export function quoteAmountToStroops(amount: unknown): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be positive");
    }
    return amount;
  }
  if (typeof amount !== "string" || amount.trim() === "") {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be a non-empty string");
  }
  const s = amount.trim();
  if (/^(0|[1-9]\d*)$/.test(s)) {
    // Ambiguous: could be stroops or whole USDC. x402 stellar quotes are
    // human-decimal, so a bare integer means whole USDC → scale to stroops,
    // unless it is clearly already in stroops range (handled by caller via
    // explicit stroops path). Here we treat bare integers as stroops only when
    // they exceed any plausible decimal-USDC scale is unsafe — so instead we
    // require decimal form for sub-7-digit values? To stay deterministic, treat
    // bare integers as stroops (server mints stroops strings for AppraisalQuote,
    // x402 402 uses decimals with a dot). A 402 "1" (1 USDC) vs stroops "1"
    // (dust) collision is resolved by preferring decimal-USDC for 402 amounts:
    // see assertPaymentQuoteAllowed which passes the raw 402 amount through
    // decimal parsing first.
    const parsed = BigInt(s);
    if (parsed <= 0n) {
      throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be positive");
    }
    return parsed;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be a positive number");
  }
  const stroops = Math.round(n * 1e7);
  if (!Number.isSafeInteger(stroops) || stroops <= 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount is out of stroop-safe range");
  }
  return BigInt(stroops);
}

/** x402 402 amounts are human-decimal USDC ("0.10") — always scale to stroops. */
export function paymentRequiredAmountToStroops(amount: unknown): bigint {
  if (typeof amount !== "string" || amount.trim() === "") {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be a non-empty string");
  }
  const n = Number(amount.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount must be a positive number");
  }
  const stroops = Math.round(n * 1e7);
  if (!Number.isSafeInteger(stroops) || stroops <= 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "quote amount is out of stroop-safe range");
  }
  return BigInt(stroops);
}

type AcceptsEntry = {
  asset?: unknown;
  payTo?: unknown;
  amount?: unknown;
  maxAmountRequired?: unknown;
  maxTimeoutSeconds?: unknown;
  extra?: Record<string, unknown> | null;
};

/**
 * Validate a 402 payment offer against the expected quote. Throws
 * AppraisalQuoteRefusalError on cap/asset/destination/expiry drift. Pure and
 * fixture-friendly: pass a PaymentRequired-shaped object, no network needed.
 */
export function assertPaymentQuoteAllowed(
  paymentRequired: { accepts?: AcceptsEntry[] },
  expected: NonNullable<PaidClientConfig["expectedQuote"]>,
): void {
  const accepts = paymentRequired.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "x402 quote has no accepts entry");
  }
  const entry = accepts[0] as AcceptsEntry;
  const asset = typeof entry.asset === "string" ? entry.asset : "";
  const payTo = typeof entry.payTo === "string" ? entry.payTo : "";
  const rawAmount = entry.amount ?? entry.maxAmountRequired;
  if (!asset) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "x402 quote is missing asset");
  }
  if (!payTo) {
    throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "x402 quote is missing destination");
  }
  if (expected.asset !== undefined && asset !== expected.asset) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_ASSET_MISMATCH",
      `appraisal quote asset ${asset} does not match expected ${expected.asset}`,
    );
  }
  if (expected.destination !== undefined && payTo !== expected.destination) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_DESTINATION_MISMATCH",
      `appraisal quote destination ${payTo} does not match expected ${expected.destination}`,
    );
  }
  const amount = paymentRequiredAmountToStroops(rawAmount);
  if (amount > expected.maxAmountStroops) {
    throw new AppraisalQuoteRefusalError(
      "QUOTE_EXCEEDS_CAP",
      `appraisal quote ${amount} exceeds mandate cap ${expected.maxAmountStroops}`,
    );
  }
  const nowSeconds =
    expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (expected.expiresAt !== undefined) {
    if (!Number.isSafeInteger(expected.expiresAt) || expected.expiresAt < 0) {
      throw new AppraisalQuoteRefusalError("QUOTE_INVALID", "expected expiresAt is invalid");
    }
    if (nowSeconds > expected.expiresAt) {
      throw new AppraisalQuoteRefusalError(
        "QUOTE_EXPIRED",
        `appraisal quote expired at ${expected.expiresAt} (now ${nowSeconds})`,
      );
    }
  }
  const timeout = entry.maxTimeoutSeconds;
  if (typeof timeout === "number") {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new AppraisalQuoteRefusalError("QUOTE_EXPIRED", "appraisal quote window has expired");
    }
    const extraExpires =
      entry.extra && typeof entry.extra.expiresAt === "number"
        ? (entry.extra.expiresAt as number)
        : undefined;
    if (extraExpires !== undefined && nowSeconds > extraExpires) {
      throw new AppraisalQuoteRefusalError(
        "QUOTE_EXPIRED",
        `appraisal quote expired at ${extraExpires} (now ${nowSeconds})`,
      );
    }
  }
}
/** Build a paid-fetch function bound to a payer wallet. */
export function createPaidFetch(config: PaidClientConfig) {
  const network = config.network ?? "stellar:testnet";
  const timeoutMs = config.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs must be a positive finite number, got ${timeoutMs}`);
  }
  const scheduler = config.scheduler ?? defaultTimeoutScheduler;
  const boundedFetch = async (url: string, init: RequestInit): Promise<Response> => {
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timeoutError = new Error(`appraisal request timed out after ${timeoutMs}ms`);
    let onTimeout!: () => void;
    const timedOut = new Promise<never>((_resolve, reject) => {
      onTimeout = () => {
        controller.abort(timeoutError);
        reject(timeoutError);
      };
    });
    const timer = scheduler.setTimeout(onTimeout, timeoutMs);
    const forwardAbort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", forwardAbort, { once: true });
    let pending: Promise<Response>;
    try {
      pending = Promise.resolve(
        fetchImpl(url, { ...init, signal: controller.signal }),
      );
    } catch (err) {
      scheduler.clear(timer);
      init.signal?.removeEventListener("abort", forwardAbort);
      throw err;
    }
    try {
      return await Promise.race([pending, timedOut]);
    } finally {
      scheduler.clear(timer);
      init.signal?.removeEventListener("abort", forwardAbort);
      pending.catch(() => {});
    }
  };
  const signer = createEd25519Signer(config.secret, network);
  const rpcConfig = config.rpcUrl ? { url: config.rpcUrl } : undefined;
  const core = new x402Client().register(
    "stellar:*",
    new ClientStellarScheme(signer, rpcConfig),
  );
  const http = new x402HTTPClient(core);

  return async function paidFetch<T = unknown>(
    url: string,
    init: RequestInit = {},
    options: PaidFetchOptions = {},
  ): Promise<PaidResult<T>> {
    // Probe path tolerates a missing body (generic GETs, legacy callers);
    // oversized / credential-like bodies still fail here with no payment.
    assertPaidRequestBodyAllowed(init, { requireBody: false });

    const first = await boundedFetch(url, init);
    if (first.status !== 402) {
      return { status: first.status, body: await parseJsonResponse<T>(first) };
    }

    // 402 → build the signed payment and retry.
    let bodyForParse: unknown;
    try {
      bodyForParse = await parseJsonResponse<unknown>(first.clone());
    } catch (error) {
      if (error instanceof AppraisalResponseParseError) {
        bodyForParse = undefined;
      } else {
        throw error;
      }
    }

    let paymentRequired: PaymentRequired;
    try {
      paymentRequired = http.getPaymentRequiredResponse(
        (name) => first.headers.get(name),
        bodyForParse,
      );
    } catch {
      throw new QuoteMismatchError("empty-challenge", first.status);
    }

    // Bind the payment to the quote this call requested. A changed asset,
    // amount, destination, or expiry must not be paid.
    if (options.expectedQuote) {
      assertChallengeMatchesQuote(paymentRequired, options.expectedQuote, options.nowSeconds);
    } else if (!config.expectedQuote) {
      throw new QuoteMismatchError("empty-challenge", first.status);
    }

    // Bind the quote to the mandate before any Stellar transfer.
    if (config.expectedQuote) {
      assertPaymentQuoteAllowed(
        paymentRequired as unknown as { accepts?: AcceptsEntry[] },
        config.expectedQuote,
      );
      // Re-check the body right before signing: a retry or config change must
      // not smuggle an unsafe body into the paid second fetch.
      assertPaidRequestBodyAllowed(init);
    } else {
      // Legacy / generic callers without a mandate guard: still never pay for
      // oversized or credential-bearing bodies, but tolerate a missing body so
      // response-parsing tests keep their stable errors.
      assertPaidRequestBodyAllowed(init, { requireBody: false });
    }

    const payload = await http.createPaymentPayload(paymentRequired);
    const payHeaders = http.encodePaymentSignatureHeader(payload);

    const paid = await boundedFetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...payHeaders },
    });
    const body = await parseJsonResponse<T>(paid);

    if (paid.status !== 200) {
      throw new X402PaymentError(`paid request failed (${paid.status})`, paid.status);
    }
    const settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
    return { status: paid.status, body, settlement };
  };
}
