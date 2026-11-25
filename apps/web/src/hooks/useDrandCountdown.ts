// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { useTime } from "../lib/time";

import { localCountdown, type DrandCountdown } from "../lib/countdown";
export { formatCountdown, type DrandCountdown } from "../lib/countdown";

export function useDrandCountdown(targetRound: number, pollMs = 1000): DrandCountdown {
  const { clock, scheduler } = useTime();
  const [state, setState] = useState<DrandCountdown>(() => ({
    loading: false,
    error: null,
    ...localCountdown(targetRound, clock.nowMs()),
  }));

  useEffect(() => {
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const countdown = localCountdown(targetRound, clock.nowMs());
      setState({
        loading: false,
        error: null,
        ...countdown,
      });
    }

    tick();
    const handle = scheduler.setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      scheduler.clear(handle);
    };
  }, [targetRound, pollMs, clock, scheduler]);

  return state;
}

