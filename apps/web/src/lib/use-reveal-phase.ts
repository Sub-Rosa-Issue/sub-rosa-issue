// Copyright (c) 2026 Sub Rosa contributors
// Shared reveal-phase resolution for the demo views.
//
// Every view that could render a bid value must derive its phase through this
// helper so the observer, attack demo, and auditor surfaces can never disagree
// with the dashboard about whether Drand R has opened the reveal round. A
// preimage is only formatted once `phase === "Reveal"` (or later).

import { useMemo } from "react";
import type { DemoTrace } from "../demo/trace";
import type { LiveSnapshot } from "../hooks/useLiveRound";
import { useTime } from "./time";
import { localCountdown } from "./countdown";
import {
  classifyRoundPhase,
  isRevealPhase,
  roundStatusFromTag,
  type RoundPhase,
} from "./round-phase";

export interface RevealPhaseInput {
  trace: Pick<DemoTrace, "meta">;
  /** Live on-chain snapshot; when present it overrides the recorded trace. */
  live?: LiveSnapshot | null;
}

export interface RevealPhaseInfo {
  phase: RoundPhase;
  /** True when bid values may be rendered from a revealed snapshot. */
  revealed: boolean;
}

/**
 * Resolve the shared round phase for a demo view.
 *
 * Live mode reads the round status tag straight from the polled on-chain
 * snapshot (no clock needed — the contract is authoritative). Evidence mode
 * falls back to the recorded trace status, which is only upgraded to "Reveal"
 * once quicknet's local countdown says Drand R has actually published.
 */
export function useRevealPhase({ trace, live }: RevealPhaseInput): RevealPhaseInfo {
  const { clock } = useTime();

  return useMemo(() => {
    if (live) {
      const phase = classifyRoundPhase({
        status: roundStatusFromTag(live.round.status.tag),
        drandPublished: false,
      });
      return { phase, revealed: isRevealPhase(phase) };
    }

    const status = roundStatusFromTag(trace.meta.roundStatus);
    const { published } = localCountdown(trace.meta.revealRound, clock.nowSeconds());
    const phase = classifyRoundPhase({ status, drandPublished: published });
    return { phase, revealed: isRevealPhase(phase) };
  }, [live, trace.meta.roundStatus, trace.meta.revealRound, clock]);
}
