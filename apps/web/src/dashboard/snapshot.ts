// Copyright (c) 2026 Sub Rosa contributors
//
// buildDashboardSnapshot produces the single shared object that both
// RoundStatusCard and KeeperStatusCard render from.  Deriving it once — and
// replacing both cards atomically — means the two cards can never diverge on
// phase, round id, or keeper cursor.
//
// Secret redaction: the keeper's lastError may contain RPC endpoint URLs or
// private keys.  redactKeeperError strips any token that looks like a URL
// scheme, a Stellar secret seed (starting with S), a hex secret, or a
// bearer/API-key pattern before the string is surfaced in the UI.

import type { DashboardData } from "./types";
import type { DashboardSnapshot, DashboardPhase } from "@sub-rosa/sdk";

// ---------------------------------------------------------------------------
// Phase classification
// ---------------------------------------------------------------------------

/**
 * Map the dashboard's coarse RoundStatus + drandPublished flag to the three
 * DashboardPhase buckets shared by both cards.
 */
export function classifyPhase(
  status: DashboardData["round"]["status"],
  drandPublished: boolean,
): DashboardPhase {
  if (status === "Settled" || status === "Voided") return "Settled";
  if (status === "Revealing" || status === "Cleared" || drandPublished) return "Reveal";
  return "Open";
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

/**
 * Patterns that identify secrets that should never appear in UI strings.
 *
 * - URL schemes (http/https/wss/ws + optional auth)
 * - Stellar secret seeds (S followed by 55 uppercase base32 chars)
 * - Long hex strings that could be private keys (≥ 32 hex chars)
 * - Bearer / API-key header values
 */
const SECRET_PATTERNS: RegExp[] = [
  // Full URLs including optional user:pass@ segment
  /https?:\/\/(?:[^@\s]*@)?[^\s]+/gi,
  // WebSocket URLs
  /wss?:\/\/[^\s]+/gi,
  // Stellar secret seeds: S + 55 uppercase A-Z2-7 chars
  /\bS[A-Z2-7]{55}\b/g,
  // Hex secrets ≥ 32 characters
  /\b[0-9a-fA-F]{32,}\b/g,
  // Bearer tokens / API keys after common keywords
  /\b(?:Bearer|Token|ApiKey|api_key|secret)\s+\S+/gi,
];

const REDACTED_TOKEN = "<redacted>";

/**
 * Strip known secret patterns from a keeper error string before it is
 * displayed in the dashboard.  Returns null when given null.
 */
export function redactKeeperError(raw: string | null): string | null {
  if (raw === null) return null;
  let out = raw;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes used across calls
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED_TOKEN);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build the single atomic snapshot that both dashboard cards consume.
 *
 * @param data          - Full DashboardData from the hook.
 * @param drandPublished - Whether the Drand round has published (from
 *                         useDrandCountdown).
 * @param stale         - Whether the data is older than the freshness
 *                        threshold (from useDashboardData).
 * @param keeperError   - Raw keeper error string, if any.  Secrets are
 *                        redacted before being stored on the snapshot.
 */
export function buildDashboardSnapshot(
  data: DashboardData,
  drandPublished: boolean,
  stale: boolean,
  keeperError: string | null = null,
): DashboardSnapshot {
  return {
    phase: classifyPhase(data.round.status, drandPublished),
    roundId: data.meta.roundId,
    keeperCursor: data.keeper.currentPhase,
    stale,
    keeperError: redactKeeperError(keeperError),
  };
}
