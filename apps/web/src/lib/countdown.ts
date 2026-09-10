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

export function timeOfRound(round: number): number {
  return QUICKNET_GENESIS + QUICKNET_PERIOD * round;
}

export function localCountdown(
  targetRound: number,
  nowSeconds: number,
): Omit<DrandCountdown, "loading" | "error"> {
  const targetTime = timeOfRound(targetRound);
  const currentRound = Math.floor((nowSeconds - QUICKNET_GENESIS) / QUICKNET_PERIOD);
  const published = currentRound >= targetRound;

  return {
    currentRound,
    targetRound,
    secondsRemaining: published ? 0 : Math.max(0, targetTime - nowSeconds),
    targetTime,
    published,
  };
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "published";
  return formatDuration(seconds);
}
