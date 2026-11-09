// Copyright (c) 2026 Sub Rosa contributors
import type http from "node:http";

export const APPRAISAL_RATE_LIMIT_EXCEEDED = "rate_limit_exceeded";
export const DEFAULT_QUOTE_RATE_LIMIT_MAX = 30;
export const DEFAULT_QUOTE_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_QUOTE_RATE_LIMIT_MAX_KEYS = 1_024;

export interface QuoteRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAtSeconds: number;
}

/**
 * Production adapter boundary for appraisal quote rate limiting.
 *
 * The default in-memory implementation bounds state per process for local
 * development and single-node pilot testing. Multi-instance production
 * deployments can pass a distributed store adapter (e.g. Redis, Upstash, or an
 * edge gateway limiter) implementing this interface to `buildAppraisalServer`.
 */
export interface QuoteRateLimiter {
  check(
    key: string,
    nowMs?: number,
  ): QuoteRateLimitDecision | Promise<QuoteRateLimitDecision>;
}

export interface InMemoryQuoteRateLimiterOptions {
  /** Maximum quote requests allowed per client key within `windowMs`. Default: 30. */
  maxRequests?: number;
  /** Window duration in milliseconds. Default: 60_000 (60 seconds). */
  windowMs?: number;
  /** Maximum distinct client keys tracked in memory. Default: 1_024. */
  maxKeys?: number;
  /** Optional clock override returning epoch milliseconds for deterministic tests. */
  nowMs?: () => number;
}

interface WindowBucket {
  count: number;
  resetAtMs: number;
}

function validatePositiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Create a bounded in-memory fixed-window rate limiter suitable for development
 * and pilot testing. Expired buckets are pruned before inserting new keys, and
 * the oldest tracked key is evicted whenever `maxKeys` is reached.
 */
export function createInMemoryQuoteRateLimiter(
  options: InMemoryQuoteRateLimiterOptions = {},
): QuoteRateLimiter {
  const maxRequests = validatePositiveInt(
    options.maxRequests ?? DEFAULT_QUOTE_RATE_LIMIT_MAX,
    "maxRequests",
  );
  const windowMs = validatePositiveInt(
    options.windowMs ?? DEFAULT_QUOTE_RATE_LIMIT_WINDOW_MS,
    "windowMs",
  );
  const maxKeys = validatePositiveInt(
    options.maxKeys ?? DEFAULT_QUOTE_RATE_LIMIT_MAX_KEYS,
    "maxKeys",
  );
  const buckets = new Map<string, WindowBucket>();

  function evictIfNeeded(now: number): void {
    if (buckets.size < maxKeys) return;
    for (const [k, bucket] of buckets) {
      if (now >= bucket.resetAtMs) {
        buckets.delete(k);
      }
    }
    while (buckets.size >= maxKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  return {
    check(key: string, nowOverrideMs?: number): QuoteRateLimitDecision {
      const normalizedKey = key.trim() || "unknown";
      const now =
        nowOverrideMs ?? options.nowMs?.() ?? globalThis.Date.now();
      const existing = buckets.get(normalizedKey);

      if (!existing || now >= existing.resetAtMs) {
        if (!existing) {
          evictIfNeeded(now);
        } else {
          buckets.delete(normalizedKey);
        }
        const resetAtMs = now + windowMs;
        buckets.set(normalizedKey, { count: 1, resetAtMs });
        return {
          allowed: true,
          limit: maxRequests,
          remaining: Math.max(0, maxRequests - 1),
          retryAfterSeconds: 0,
          resetAtSeconds: Math.ceil(resetAtMs / 1000),
        };
      }

      // Refresh key insertion order on active use so eviction stays LRU-bounded.
      buckets.delete(normalizedKey);
      if (existing.count >= maxRequests) {
        buckets.set(normalizedKey, existing);
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing.resetAtMs - now) / 1000),
        );
        return {
          allowed: false,
          limit: maxRequests,
          remaining: 0,
          retryAfterSeconds,
          resetAtSeconds: Math.ceil(existing.resetAtMs / 1000),
        };
      }

      existing.count += 1;
      buckets.set(normalizedKey, existing);
      return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - existing.count),
        retryAfterSeconds: 0,
        resetAtSeconds: Math.ceil(existing.resetAtMs / 1000),
      };
    },
  };
}

/** Resolve a stable per-client rate-limit key from an incoming HTTP request. */
export function resolveQuoteClientKey(req: http.IncomingMessage): string {
  const socketAddr = req.socket?.remoteAddress?.trim();
  if (socketAddr) return socketAddr;
  return "unknown";
}

/** Build standard HTTP rate-limit headers from a rate-limit decision. */
export function toRateLimitHeaders(
  decision: QuoteRateLimitDecision,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(decision.resetAtSeconds),
  };
  if (!decision.allowed) {
    headers["retry-after"] = String(decision.retryAfterSeconds);
  }
  return headers;
}
