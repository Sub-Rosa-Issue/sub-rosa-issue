// Copyright (c) 2026 Sub Rosa contributors
import type http from "node:http";

export interface QuoteRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Production boundary for appraisal quote creation.
 * The in-memory adapter below is single-process and suitable for development
 * and tests. A production deployment should pass an implementation backed by
 * a shared store so every replica enforces the same window.
 */
export interface QuoteRateLimiter {
  take(key: string, nowMs: number): QuoteRateLimitDecision;
}

export interface MemoryQuoteRateLimitOptions {
  /** Quotes allowed per key inside one window. */
  limit: number;
  /** Fixed window length in milliseconds. */
  windowMs: number;
  /** Maximum distinct keys retained. New keys are refused once this is full. */
  maxKeys: number;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

/** Bounded fixed-window limiter. The key map cannot grow past `maxKeys`. */
export function createMemoryQuoteRateLimiter(
  options: MemoryQuoteRateLimitOptions,
): QuoteRateLimiter {
  assertPositiveInteger(options.limit, "limit");
  assertPositiveInteger(options.windowMs, "windowMs");
  assertPositiveInteger(options.maxKeys, "maxKeys");

  const buckets = new Map<string, { windowStart: number; count: number }>();

  return {
    take(key, nowMs) {
      if (!Number.isFinite(nowMs)) {
        return { allowed: false, retryAfterMs: options.windowMs };
      }
      const safeKey = key.trim() || "unknown";
      const existing = buckets.get(safeKey);
      const expired = !existing || nowMs - existing.windowStart >= options.windowMs;
      if (expired) {
        if (!existing && buckets.size >= options.maxKeys) {
          return { allowed: false, retryAfterMs: options.windowMs };
        }
        buckets.set(safeKey, { windowStart: nowMs, count: 1 });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (existing.count >= options.limit) {
        const retryAfterMs = options.windowMs - (nowMs - existing.windowStart);
        return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
      }
      existing.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

/** Development defaults: 30 quotes per minute, at most 1,000 client keys. */
export const DEVELOPMENT_QUOTE_RATE_LIMIT: MemoryQuoteRateLimitOptions = {
  limit: 30,
  windowMs: 60_000,
  maxKeys: 1_000,
};

/** Client identity for the development limiter. Does not read forwarded headers. */
export function appraisalQuoteRateKey(req: http.IncomingMessage): string {
  return req.socket?.remoteAddress || "unknown";
}
