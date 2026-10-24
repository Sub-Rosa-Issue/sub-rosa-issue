// Copyright (c) 2026 Sub Rosa contributors
import type { IncomingMessage } from "node:http";

/** Stable error code returned when appraisal quote creation exceeds the rate limit. */
export const APPRAISAL_RATE_LIMITED = "rate_limit_exceeded";

/** Default max quote creations per window per client key in development mode. */
export const DEFAULT_QUOTE_RATE_LIMIT_MAX_REQUESTS = 30;

/** Default rate-limit window duration in milliseconds (60 seconds). */
export const DEFAULT_QUOTE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Default cap on tracked keys in the in-memory development limiter. */
export const DEFAULT_QUOTE_RATE_LIMIT_MAX_KEYS = 1_024;

export interface AppraisalQuoteRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
}

/**
 * Production adapter boundary for appraisal quote creation rate limiting.
 *
 * Local and development runs default to {@link InMemoryQuoteRateLimiter}.
 * Multi-instance production deployments should inject a shared store adapter
 * (e.g. Redis, Cloudflare Durable Objects, or API gateway token bucket)
 * implementing this interface.
 */
export interface AppraisalQuoteRateLimiter {
  consume(
    key: string,
    nowMs?: number,
  ): AppraisalQuoteRateLimitDecision | Promise<AppraisalQuoteRateLimitDecision>;
}

export interface InMemoryQuoteRateLimiterOptions {
  /** Max allowed requests per window per key. Default: 30. */
  maxRequests?: number;
  /** Window length in milliseconds. Default: 60_000. */
  windowMs?: number;
  /** Maximum distinct keys retained in memory at once. Default: 1_024. */
  maxKeys?: number;
  /** Injectable clock returning epoch milliseconds. */
  nowMs?: () => number;
}

interface BucketEntry {
  count: number;
  resetAtMs: number;
}

/**
 * Bounded in-memory fixed-window rate limiter for local/development servers.
 * Evicts expired windows first and then evicts the oldest key when `maxKeys`
 * is reached so memory usage remains strictly bounded under key-churn attacks.
 */
export class InMemoryQuoteRateLimiter implements AppraisalQuoteRateLimiter {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  readonly #nowMs: () => number;
  readonly #buckets = new Map<string, BucketEntry>();

  constructor(options: InMemoryQuoteRateLimiterOptions = {}) {
    const maxRequests = options.maxRequests ?? DEFAULT_QUOTE_RATE_LIMIT_MAX_REQUESTS;
    const windowMs = options.windowMs ?? DEFAULT_QUOTE_RATE_LIMIT_WINDOW_MS;
    const maxKeys = options.maxKeys ?? DEFAULT_QUOTE_RATE_LIMIT_MAX_KEYS;

    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new Error("maxRequests must be a positive integer");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("windowMs must be a positive integer");
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new Error("maxKeys must be a positive integer");
    }

    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.#nowMs = options.nowMs ?? (() => globalThis.Date.now());
  }

  /** Current number of active keys tracked in memory. */
  get size(): number {
    return this.#buckets.size;
  }

  consume(key: string, nowMs = this.#nowMs()): AppraisalQuoteRateLimitDecision {
    const normalizedKey = key.trim() || "unknown";
    const existing = this.#buckets.get(normalizedKey);

    if (existing && nowMs < existing.resetAtMs) {
      if (existing.count >= this.maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing.resetAtMs - nowMs) / 1000),
        );
        return {
          allowed: false,
          limit: this.maxRequests,
          remaining: 0,
          retryAfterSeconds,
          resetAtMs: existing.resetAtMs,
        };
      }
      existing.count += 1;
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - existing.count),
        retryAfterSeconds: 0,
        resetAtMs: existing.resetAtMs,
      };
    }

    if (existing) {
      this.#buckets.delete(normalizedKey);
    }

    if (this.#buckets.size >= this.maxKeys) {
      this.#evictExpiredOrOldest(nowMs);
    }

    const resetAtMs = nowMs + this.windowMs;
    this.#buckets.set(normalizedKey, { count: 1, resetAtMs });
    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - 1),
      retryAfterSeconds: 0,
      resetAtMs,
    };
  }

  #evictExpiredOrOldest(nowMs: number): void {
    for (const [k, entry] of this.#buckets.entries()) {
      if (nowMs >= entry.resetAtMs) {
        this.#buckets.delete(k);
      }
    }
    while (this.#buckets.size >= this.maxKeys) {
      const oldestKey = this.#buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.#buckets.delete(oldestKey);
    }
  }
}

/** Resolve a stable client key from the socket remote address. */
export function resolveQuoteRateLimitKey(
  req: Pick<IncomingMessage, "socket">,
): string {
  const remote = req.socket?.remoteAddress?.trim();
  return remote && remote.length > 0 ? remote : "unknown";
}

export function rateLimitHeaders(
  decision: AppraisalQuoteRateLimitDecision,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAtMs / 1000)),
  };
  if (!decision.allowed) {
    headers["retry-after"] = String(decision.retryAfterSeconds);
  }
  return headers;
}

export function appraisalRateLimitedBody(
  decision: Pick<AppraisalQuoteRateLimitDecision, "retryAfterSeconds">,
): {
  error: typeof APPRAISAL_RATE_LIMITED;
  retryAfterSeconds: number;
} {
  return {
    error: APPRAISAL_RATE_LIMITED,
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}
