// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { quicknet } from "@sub-rosa/tlock";
import { useTime } from "../lib/time";

import { localCountdown, type DrandCountdown } from "../lib/countdown";
export { formatCountdown, type DrandCountdown } from "../lib/countdown";

export function useDrandCountdown(targetRound: number, pollMs = 1000): DrandCountdown {
  const { clock, scheduler } = useTime();
  const [state, setState] = useState<DrandCountdown>(() => ({
    loading: false,
    error: null,
    ...localCountdown(targetRound, clock.nowSeconds()),
  }));

  useEffect(() => {
    let cancelled = false;
    const client = quicknet();

    async function tick() {
      const fallback = localCountdown(targetRound, clock.nowSeconds());

      try {
        const info = await client.chain().info();
        const genesis = info.genesis_time;
        const period = info.period;
        const now = clock.nowSeconds();
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
    const handle = scheduler.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      scheduler.clear(handle);
    };
  }, [targetRound, pollMs, clock, scheduler]);

  return state;
}

