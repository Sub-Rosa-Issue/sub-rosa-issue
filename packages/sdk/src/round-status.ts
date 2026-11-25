// Pure helpers for reasoning about keeper round statuses without depending on
// the keeper service itself. These classify a `RoundStatus` into coarse
// buckets (active / terminal / error) and turn a status into a human-readable
// label suitable for dashboards, operator CLIs and alert copy.
//
// Keep the status vocab in lockstep with `services/keeper/src/status.ts`.

import type {
  KeeperRoundStatusView,
  RoundStatus,
  SettlementIndicator,
} from "./status.js";

export const ACTIVE_ROUND_STATUSES: readonly RoundStatus[] = [
  "Open",
  "Revealing",
  "Cleared",
];

export const TERMINAL_ROUND_STATUSES: readonly RoundStatus[] = [
  "Settled",
  "Voided",
];

export const ERROR_ROUND_STATUSES: readonly RoundStatus[] = [
  "Unknown",
  "NotFound",
];

export type RoundStatusClass = "active" | "terminal" | "error";

export function classifyRoundStatus(status: RoundStatus): RoundStatusClass {
  if (isActiveRoundStatus(status)) return "active";
  if (isTerminalRoundStatus(status)) return "terminal";
  return "error";
}

export function isActiveRoundStatus(status: RoundStatus): boolean {
  return (ACTIVE_ROUND_STATUSES as readonly string[]).includes(status);
}

export function isTerminalRoundStatus(status: RoundStatus): boolean {
  return (TERMINAL_ROUND_STATUSES as readonly string[]).includes(status);
}

export function isErrorRoundStatus(status: RoundStatus): boolean {
  return (ERROR_ROUND_STATUSES as readonly string[]).includes(status);
}

const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  Unknown: "Unknown — keeper has not resolved the round yet",
  Open: "Open — accepting commitments",
  Revealing: "Revealing — accepting reveals",
  Cleared: "Cleared — awaiting settlement",
  Settled: "Settled — round complete",
  Voided: "Voided — escrow refunded",
  NotFound: "NotFound — round does not exist on-chain",
};

export function roundStatusLabel(status: RoundStatus): string {
  return ROUND_STATUS_LABELS[status];
}

// Coarse UI phases derived from a round status. The web dashboard must render
// one of these names so it cannot invent a fourth phase label that drifts from
// the keeper vocabulary above.
export type RoundPhase = "Open" | "Reveal" | "Settled";

export const ROUND_PHASES: readonly RoundPhase[] = ["Open", "Reveal", "Settled"];

export const ROUND_PHASE_LABELS: Record<RoundPhase, string> = {
  Open: "Open",
  Reveal: "Reveal",
  Settled: "Settled",
};

export function roundPhaseLabel(phase: RoundPhase): string {
  return ROUND_PHASE_LABELS[phase];
}

export function isRoundPhase(value: string): value is RoundPhase {
  return (ROUND_PHASES as readonly string[]).includes(value);
}

export function isKeeperRoundActive(view: KeeperRoundStatusView): boolean {
  return isActiveRoundStatus(view.status);
}

export function isKeeperRoundTerminal(view: KeeperRoundStatusView): boolean {
  return isTerminalRoundStatus(view.status);
}

export function isKeeperRoundSettlementPending(
  view: KeeperRoundStatusView,
): boolean {
  const pending: readonly SettlementIndicator[] = ["pending", "submitted"];
  return (pending as readonly string[]).includes(view.settlement);
}
