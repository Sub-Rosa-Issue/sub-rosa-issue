// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { quicknet } from "@sub-rosa/tlock";

const QUICKNET_GENESIS = 1_692_803_367;
const QUICKNET_PERIOD = 3;

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

function timeOfRound(round: number): number {
  return QUICKNET_GENESIS + QUICKNET_PERIOD * round;
}

function localCountdown(targetRound: number): Omit<DrandCountdown, "loading" | "error"> {
  const now = Math.floor(Date.now() / 1000);
  const targetTime = timeOfRound(targetRound);
  const currentRound = Math.floor((now - QUICKNET_GENESIS) / QUICKNET_PERIOD);
  const published = currentRound >= targetRound;

  return {
    currentRound,
    targetRound,
    secondsRemaining: published ? 0 : Math.max(0, targetTime - now),
    targetTime,
    published,
  };
}

export function useDrandCountdown(targetRound: number, pollMs = 1000): DrandCountdown {
  const [state, setState] = useState<DrandCountdown>(() => ({
    loading: false,
    error: null,
    ...localCountdown(targetRound),
  }));

  useEffect(() => {
    let cancelled = false;
    const client = quicknet();

    async function tick() {
      const fallback = localCountdown(targetRound);

      try {
        const info = await client.chain().info();
        const genesis = info.genesis_time;
        const period = info.period;
        const now = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor((now - genesis) / period);
        const targetTime = genesis + period * targetRound;
        const published = currentRound >= targetRound;
        const secondsRemaining = published ? 0 : Math.max(0, targetTime - now);

        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            currentRound,
            targetRound,
            secondsRemaining,
            targetTime,
            published,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            ...fallback,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [targetRound, pollMs]);

  return state;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "published";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
