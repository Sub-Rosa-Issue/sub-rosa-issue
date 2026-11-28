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
  trustedProxyIps?: readonly string[];
}

/**
 * Normalize a client IP address (trim, unwrap `[ipv6]:port` or `ipv4:port`,
 * strip IPv4-mapped `::ffff:` prefix, lowercase IPv6). Returns `""` if invalid.
 */
export function normalizeClientIp(raw: string | undefined): string {
  if (!raw) return "";
  const value = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  const ipv4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  const address = bracketed?.[1] ?? ipv4Port?.[1] ?? value;
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6 || address.includes("%")) return "";
  const ipv6 = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ipv6);
  if (!mapped) return ipv6;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function appraisalQuoteRateKey(
  req: http.IncomingMessage,
  options: AppraisalQuoteRateKeyOptions = {},
): string {
  const peer = normalizeClientIp(req.socket?.remoteAddress);
  if (!peer || !options.trustedProxyIps?.some((ip) => normalizeClientIp(ip) === peer)) {
    return peer || "unknown";
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return peer;
  // The trusted gateway appends or replaces the actual client's address.
  const client = forwarded.slice(forwarded.lastIndexOf(",") + 1);
  return normalizeClientIp(client) || peer;
}
