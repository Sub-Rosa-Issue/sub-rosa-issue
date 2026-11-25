// Copyright (c) 2026 Sub Rosa contributors
import { formatDuration } from "./format";

export const QUICKNET_GENESIS = 1_692_803_367;
export const QUICKNET_PERIOD = 3;

export interface DrandCountdown {
  loading: boolean;
  error: string | null;
  currentRound: number | null;
  targetRound: number;
  /** Seconds until target round is expected; 0 when published or past. */
  secondsRemaining: number;
  /** Unix seconds when target round is expected. */
  targetTime: number;
  published: boolean;
}

export function timeOfRound(
  round: number,
  period = QUICKNET_PERIOD,
  genesis = QUICKNET_GENESIS,
): number {
  return genesis + period * round;
}

export function revealInstantMs(
  round: number,
  period = QUICKNET_PERIOD,
  genesis = QUICKNET_GENESIS,
): number {
  return timeOfRound(round, period, genesis) * 1000;
}

export function localCountdown(
  targetRound: number,
  nowOrMs: number,
  period = QUICKNET_PERIOD,
  genesis = QUICKNET_GENESIS,
): Omit<DrandCountdown, "loading" | "error"> {
  const isMs = nowOrMs > 1e11;
  const nowMs = isMs ? nowOrMs : Math.round(nowOrMs * 1000);
  const nowSeconds = isMs ? Math.floor(nowOrMs / 1000) : Math.floor(nowOrMs);
  const targetTime = timeOfRound(targetRound, period, genesis);
  const targetTimeMs = targetTime * 1000;
  const currentRound = Math.floor((nowSeconds - genesis) / period);
  const published = nowMs >= targetTimeMs;

  return {
    currentRound,
    targetRound,
    secondsRemaining: published ? 0 : Math.max(1, Math.ceil((targetTimeMs - nowMs) / 1000)),
    targetTime,
    published,
  };
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "published";
  return formatDuration(seconds);
}
