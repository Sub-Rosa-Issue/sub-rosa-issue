import { publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useRef, useState } from "react";
import type { Round, BidState } from "@sub-rosa/sdk";
import { useTime } from "../lib/time";

import type { TimerHandle } from "@sub-rosa/time";

export interface LiveRoundOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId?: string;
  roundId?: bigint;
}

function defaultOptions(): LiveRoundOptions {
  return {
    rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: import.meta.env.VITE_CONTRACT_ID,
    roundId: import.meta.env.VITE_ROUND_ID ? BigInt(import.meta.env.VITE_ROUND_ID) : undefined,
  };
}

export interface LiveSnapshot {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
  polledAt: number;
}

export function useLiveRound(enabled: boolean, pollMs = 12_000, options?: LiveRoundOptions) {
  const { clock, scheduler } = useTime();
  const { rpcUrl: RPC, networkPassphrase: NETWORK, contractId: CONTRACT, roundId: ROUND_ID } = options ?? defaultOptions();
  // Survives effect replacement so a new configuration waits for old I/O to finish.
  const inFlight = useRef<Promise<void> | null>(null);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !CONTRACT || ROUND_ID === undefined) return;

    let cancelled = false;
    let handle: TimerHandle | undefined;

    async function readSnapshot() {
      try {
        const { SubRosaClient } = await import("@sub-rosa/sdk");
        const reader = new SubRosaClient({
          rpcUrl: RPC,
          networkPassphrase: NETWORK,
          contractId: CONTRACT!,
          publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        });
        const round = await reader.getRound(ROUND_ID!);
        const bidders = await reader.getBidders(ROUND_ID!);
        const bidStates: Record<string, BidState> = {};
        for (const b of bidders) {
          bidStates[b] = await reader.getBidState(ROUND_ID!, b);
        }
        if (!cancelled) {
          setLive({ round, bidders, bidStates, polledAt: clock.nowMs() });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(publicErrorMessage(e));
      }
    }

    async function poll() {
      await inFlight.current;
      if (cancelled) return;
      const work = readSnapshot();
      inFlight.current = work;
      try {
        await work;
      } finally {
        if (inFlight.current === work) inFlight.current = null;
        if (!cancelled) handle = scheduler.setTimeout(() => void poll(), pollMs);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (handle) scheduler.clear(handle);
    };
  }, [enabled, pollMs, clock, scheduler, RPC, NETWORK, CONTRACT, ROUND_ID]);

  return { live, error, configured: Boolean(CONTRACT && ROUND_ID !== undefined) };
}
