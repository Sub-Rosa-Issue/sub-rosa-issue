import { publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useRef, useState } from "react";
import type { Round, BidState } from "@sub-rosa/sdk";
import { useTime } from "../lib/time";
import { classifyRoundPhase, type RoundPhase } from "../lib/round-phase";

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

/**
 * One immutable view of a live round. Phase, reveal cursor and escrow totals
 * travel together so the countdown, badge and settlement card can never
 * disagree about which round state they are describing.
 */
export interface RoundSnapshot {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
  /** Coarse phase derived from the round status and drand publication. */
  phase: RoundPhase;
  /** Number of bidders whose reveal has landed, and the total bidder count. */
  revealCursor: { revealed: number; total: number };
  /** Escrow totals observed for this snapshot. */
  escrow: { committed: bigint; revealed: bigint };
  /** Monotonic sequence used to reject out-of-order poll responses. */
  sequence: number;
  polledAt: number;
}

/** Backwards-compatible alias for the snapshot shape. */
export type LiveSnapshot = RoundSnapshot;

export interface BuildRoundSnapshotInput {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
  drandPublished: boolean;
  sequence: number;
  polledAt: number;
}

export function buildRoundSnapshot({
  round,
  bidders,
  bidStates,
  drandPublished,
  sequence,
  polledAt,
}: BuildRoundSnapshotInput): RoundSnapshot {
  const states = Object.values(bidStates);
  const revealed = states.filter((state) => state.revealed_value != null).length;
  const revealedTotal = states.reduce(
    (sum, state) => sum + (state.revealed_value ?? 0n),
    0n,
  );
  return {
    round,
    bidders,
    bidStates,
    phase: classifyRoundPhase({ status: round.status, drandPublished }),
    revealCursor: { revealed, total: bidders.length },
    escrow: { committed: round.escrow ?? 0n, revealed: revealedTotal },
    sequence,
    polledAt,
  };
}

/**
 * Returns true when `incoming` may replace `current`. A poll response is only
 * accepted when it is strictly newer than the snapshot already on screen, so a
 * slow response can never mark a round settled while a reveal is in flight.
 */
export function isNewerSnapshot(
  incoming: RoundSnapshot,
  current: RoundSnapshot | null,
): boolean {
  if (!current) return true;
  return incoming.sequence > current.sequence;
}

export function useLiveRound(
  enabled: boolean,
  pollMs = 12_000,
  options?: LiveRoundOptions,
  drandPublished = false,
) {
  const { clock, scheduler } = useTime();
  const { rpcUrl: RPC, networkPassphrase: NETWORK, contractId: CONTRACT, roundId: ROUND_ID } = options ?? defaultOptions();
  // Survives effect replacement so a new configuration waits for old I/O to finish.
  const inFlight = useRef<Promise<void> | null>(null);
  const sequence = useRef(0);
  const [live, setLive] = useState<RoundSnapshot | null>(null);
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
        if (cancelled) return;
        const snapshot = buildRoundSnapshot({
          round,
          bidders,
          bidStates,
          drandPublished,
          sequence: ++sequence.current,
          polledAt: clock.nowMs(),
        });
        setLive((current) => (isNewerSnapshot(snapshot, current) ? snapshot : current));
        setError(null);
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
  }, [enabled, pollMs, clock, scheduler, RPC, NETWORK, CONTRACT, ROUND_ID, drandPublished]);

  return { live, error, configured: Boolean(CONTRACT && ROUND_ID !== undefined) };
}
