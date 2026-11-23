// SPDX-License-Identifier: MIT
// Typed response shapes for the keeper status API. These mirror the stable
// JSON the status HTTP server emits, so client code (dashboards, monitoring
// probes, an operator's CLI helpers) can consume `GET /status`,
// `GET /status/rounds/:id`, and `GET /healthz` without guessing field names.
//
// Keep these in lockstep with `services/keeper/src/status.ts`.

export type RoundStatus =
  | "Unknown"
  | "Open"
  | "Revealing"
  | "Cleared"
  | "Settled"
  | "Voided"
  | "NotFound";

export type SettlementIndicator = "pending" | "submitted" | "terminal" | "none";

export type KeeperHealthState = "ok" | "degraded" | "down";

export interface KeeperRoundStatusView {
  roundId: string;
  status: RoundStatus;
  phase:
    | "awaiting-drand"
    | "stale-open"
    | "revealing"
    | "awaiting-clear"
    | "ready-to-clear"
    | "ready-to-settle"
    | "complete";
  nextAction: string;
  commitDeadline: number | null;
  revealDeadline: number | null;
  revealRound: number | null;
  revealReady: boolean;
  commitClosed: boolean;
  revealWindowOpen: boolean;
  voidableAfter: number | null;
  bidderCount: number | null;
  revealedCount: number | null;
  winner: string | null;
  winningValue: string | null;
  clearingRule: "HighestBid" | "LowestBid" | null;
  settlement: SettlementIndicator;
  lastKeeperAction: string | null;
  lastError: string | null;
  retryCount: number;
  updatedAt: string;
}

export interface KeeperServiceHealth {
  rpc: KeeperHealthState;
  drand: KeeperHealthState;
  reason?: string;
  checkedAt: string;
}

export interface KeeperStatusResponse {
  contractId: string;
  network: string;
  uptimeSeconds: number;
  rounds: KeeperRoundStatusView[];
  health: KeeperServiceHealth;
  now: string;
}

export interface KeeperHealthResponse {
  health: KeeperServiceHealth;
  now: string;
}

export interface ApiError {
  error: string;
  path?: string;
  available?: string[];
  roundIds?: string[];
  roundId?: string;
}

/**
 * A single, atomic snapshot shared by the round-status card and the
 * keeper-status card so they can never disagree about phase, round id, or
 * keeper cursor.
 *
 * `stale` is set when the snapshot is backed by an older data fetch, so
 * consumers can render a staleness indicator without having to re-derive it.
 *
 * `keeperError` carries the *redacted* error string from the last keeper
 * failure (RPC secrets removed).  When present the snapshot falls back to the
 * last verified `phase` so the UI always has something coherent to show.
 */
export type DashboardPhase = "Open" | "Reveal" | "Settled";

export interface DashboardSnapshot {
  /** Canonical phase agreed on by both cards. */
  phase: DashboardPhase;
  /** Numeric round identifier from `meta.roundId`. */
  roundId: number;
  /** Keeper cursor (current phase slug from the keeper service). */
  keeperCursor: string;
  /** True when the backing data is older than the freshness threshold. */
  stale: boolean;
  /**
   * Redacted keeper error string, if any.  RPC secrets (URLs, keys) are
   * stripped before this reaches the UI.
   */
  keeperError: string | null;
}
