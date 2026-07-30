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

/**
 * Pure countdown calculation — accepts fixed timestamps, genesis, and period
 * so tests can pin the wall clock. Produces deterministic
 * { currentRound, targetTime, published, secondsRemaining }.
 */
export function computeCountdown(
  targetRound: number,
  nowSecs: number,
  genesis: number,
  period: number,
): { currentRound: number; targetTime: number; published: boolean; secondsRemaining: number } {
  const currentRound = Math.floor((nowSecs - genesis) / period);
  const targetTime = genesis + period * targetRound;
  const published = currentRound >= targetRound;

  return {
    currentRound,
    targetTime,
    published,
    secondsRemaining: published ? 0 : Math.max(0, targetTime - nowSecs),
  };
}

function localCountdown(targetRound: number): Omit<DrandCountdown, "loading" | "error"> {
  const now = Math.floor(Date.now() / 1000);
  const { currentRound, targetTime, published, secondsRemaining } =
    computeCountdown(targetRound, now, QUICKNET_GENESIS, QUICKNET_PERIOD);

  return {
    currentRound,
    targetRound,
    secondsRemaining,
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
        const { currentRound, targetTime, published, secondsRemaining } =
          computeCountdown(targetRound, now, genesis, period);

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
