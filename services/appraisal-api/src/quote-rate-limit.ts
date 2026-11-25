// Copyright (c) 2026 Sub Rosa contributors
import type http from "node:http";
import { isIP } from "node:net";

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
        const retryAfterMs = Math.min(
          options.windowMs,
          Math.max(1, options.windowMs - (nowMs - existing.windowStart)),
        );
        return { allowed: false, retryAfterMs };
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

export interface AppraisalQuoteRateKeyOptions {
  /** Trust `X-Forwarded-For` header. Defaults to false (use socket address only). */
  trustProxy?: boolean;
}

/**
 * Normalize a client IP address (trim, unwrap `[ipv6]:port` or `ipv4:port`,
 * strip IPv4-mapped `::ffff:` prefix, lowercase IPv6). Returns `""` if invalid.
 */
export function normalizeClientIp(raw: string | undefined): string {
  if (!raw) return "";
  let candidate = raw.trim();
  if (!candidate) return "";

  if (candidate.startsWith("[")) {
    const closeIdx = candidate.indexOf("]");
    if (closeIdx === -1) return "";
    candidate = candidate.slice(1, closeIdx);
  } else {
    const colonCount = (candidate.match(/:/g) ?? []).length;
    if (colonCount === 1) {
      const host = candidate.slice(0, candidate.indexOf(":"));
      if (isIP(host) === 4) {
        candidate = host;
      }
    }
  }

  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const v4 = candidate.slice(7);
    if (isIP(v4) === 4) {
      candidate = v4;
    }
  }

  const family = isIP(candidate);
  if (family === 4) return candidate;
  if (family === 6) return candidate.toLowerCase();
  return "";
}

/**
 * Client identity for the development limiter.
 * Ignores `X-Forwarded-For` by default; honors it only when `trustProxy: true`.
 */
export function appraisalQuoteRateKey(
  req: http.IncomingMessage,
  options: AppraisalQuoteRateKeyOptions = {},
): string {
  if (options.trustProxy === true) {
    const forwarded = req.headers["x-forwarded-for"];
    const rawForwarded = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    if (rawForwarded) {
      const first = rawForwarded.split(",")[0];
      const normalized = normalizeClientIp(first);
      if (normalized) return normalized;
    }
  }
  return normalizeClientIp(req.socket?.remoteAddress) || "unknown";
}
