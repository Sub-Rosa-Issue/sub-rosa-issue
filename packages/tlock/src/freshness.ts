// Copyright (c) 2026 Sub Rosa contributors
export const DEFAULT_STALE_THRESHOLD_MS = 60_000;

export interface DrandRoundInfo {
  genesis_time: number;
  period: number;
}

export type FreshnessStatus = "fresh" | "stale" | "future" | "unknown";

export interface FreshnessResult {
  status: FreshnessStatus;
  reason?: string;
  publishAtMs?: number;
  ageMs?: number;
}

/**
 * Derives a Drand round publication timestamp in milliseconds, rejecting
 * intermediate calculations that would exceed Number.MAX_SAFE_INTEGER.
 */
export function computePublishAtMs(info: DrandRoundInfo, round: number): number | null {
  if (!Number.isSafeInteger(round) || round <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(info.period) || info.period <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(info.genesis_time) || info.genesis_time < 0) {
    return null;
  }

  const offsetSeconds = info.period * round;
  if (!Number.isSafeInteger(offsetSeconds)) {
    return null;
  }

  const publishAtSeconds = info.genesis_time + offsetSeconds;
  if (!Number.isSafeInteger(publishAtSeconds) || publishAtSeconds < 0) {
    return null;
  }

  const publishAtMs = publishAtSeconds * 1000;
  if (!Number.isSafeInteger(publishAtMs)) {
    return null;
  }

  return publishAtMs;
}

/**
 * Classifies a Drand round's freshness deterministically using the current time
 * and Drand network info.
 */
export function classifyDrandRound(
  round: number | undefined | null,
  info: DrandRoundInfo | undefined | null,
  nowMs: number,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): FreshnessResult {
  if (round == null || round <= 0 || !Number.isSafeInteger(round)) {
    return { status: "unknown", reason: "missing or invalid round" };
  }
  if (!info || typeof info.genesis_time !== "number" || typeof info.period !== "number") {
    return { status: "unknown", reason: "missing or invalid drand info" };
  }
  if (info.period <= 0 || info.genesis_time < 0) {
    return {
      status: "unknown",
      reason: "malformed drand info (negative or zero period/genesis)",
    };
  }
  if (typeof nowMs !== "number" || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { status: "unknown", reason: "invalid timestamp" };
  }

  const publishAtMs = computePublishAtMs(info, round);
  if (publishAtMs == null) {
    return { status: "unknown", reason: "timestamp overflow or unsafe calculation" };
  }

  if (nowMs < publishAtMs) {
    return {
      status: "future",
      reason: "round has not been published yet",
      publishAtMs,
    };
  }

  const ageMs = nowMs - publishAtMs;

  if (ageMs > staleThresholdMs) {
    return {
      status: "stale",
      reason: "round is older than stale threshold",
      publishAtMs,
      ageMs,
    };
  }

  return { status: "fresh", reason: "round is fresh", publishAtMs, ageMs };
}
