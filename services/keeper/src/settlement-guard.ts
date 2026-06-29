// settlement-guard.ts
//
// In-memory duplicate-settlement suppression for the keeper.
//
// A keeper may observe the same round across many polling cycles. Without
// this guard it would attempt to settle an already-submitted (or terminal)
// round on every tick. The guard tracks a small per-round state machine:
//
//   pending  →  submitted  (settle() called, waiting for confirmation)
//   pending  →  terminal   (round already Settled / Voided / irreversible)
//   submitted → terminal   (confirmation arrived)
//   submitted → pending    (network error — retryable, NOT permanently suppressed)
//
// Only "pending" rounds are allowed to proceed to settlement. Submitted and
// terminal rounds are skipped with a structured log event that carries a
// `skippedDuplicateReason` field so it is searchable in structured logs.

export type SettlementGuardStatus = "pending" | "submitted" | "terminal";

export interface SettlementGuardEntry {
  roundId: bigint;
  status: SettlementGuardStatus;
  /** ISO-8601 timestamp of the last status change. */
  updatedAt: string;
  /** Human-readable reason recorded when the entry was last updated. */
  reason: string;
}

/** Structured event emitted when a duplicate settlement is suppressed. */
export interface DuplicateSkipEvent {
  event: "settlement_skipped_duplicate";
  roundId: string;
  /** The guard status that caused the skip: "submitted" or "terminal". */
  skippedDuplicateReason: SettlementGuardStatus;
  lastReason: string;
}

export interface SettlementGuard {
  /**
   * Check whether settlement may proceed for this round.
   *
   * Returns `{ allowed: true }` when the round is "pending".
   * Returns `{ allowed: false, event }` when the round is "submitted" or
   * "terminal", so the caller can log the structured event.
   */
  canSettle(
    roundId: bigint,
  ): { allowed: true } | { allowed: false; event: DuplicateSkipEvent };

  /** Call immediately before dispatching the settle transaction. */
  markSubmitted(roundId: bigint): void;

  /**
   * Call when the settle transaction is confirmed (or the round is already
   * in a terminal on-chain state such as Settled or Voided).
   */
  markTerminal(roundId: bigint, reason: string): void;

  /**
   * Call when a settle attempt fails with a retryable error (e.g. network
   * timeout). The entry reverts to "pending" so the next polling cycle can
   * retry. Failed work is never permanently suppressed.
   */
  markRetryable(roundId: bigint, reason: string): void;

  /** Read the current entry for a round (useful in tests and dry-run logging). */
  getEntry(roundId: bigint): SettlementGuardEntry | undefined;

  /** All tracked entries, ordered by insertion. */
  entries(): SettlementGuardEntry[];
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Create a fresh in-memory SettlementGuard.
 *
 * The guard is intentionally stateless across process restarts — persistence
 * would add complexity and a keeper restart is already a safe recovery action
 * because it re-reads on-chain state before deciding whether to settle.
 */
export function createSettlementGuard(): SettlementGuard {
  const entries = new Map<bigint, SettlementGuardEntry>();

  function getOrCreate(roundId: bigint): SettlementGuardEntry {
    if (!entries.has(roundId)) {
      entries.set(roundId, {
        roundId,
        status: "pending",
        updatedAt: now(),
        reason: "initial",
      });
    }
    return entries.get(roundId)!;
  }

  return {
    canSettle(roundId) {
      const entry = getOrCreate(roundId);
      if (entry.status === "pending") {
        return { allowed: true };
      }
      return {
        allowed: false,
        event: {
          event: "settlement_skipped_duplicate",
          roundId: roundId.toString(),
          skippedDuplicateReason: entry.status,
          lastReason: entry.reason,
        },
      };
    },

    markSubmitted(roundId) {
      const entry = getOrCreate(roundId);
      entry.status = "submitted";
      entry.updatedAt = now();
      entry.reason = "settle tx dispatched";
    },

    markTerminal(roundId, reason) {
      const entry = getOrCreate(roundId);
      entry.status = "terminal";
      entry.updatedAt = now();
      entry.reason = reason;
    },

    markRetryable(roundId, reason) {
      const entry = getOrCreate(roundId);
      // Retryable failures go back to pending so the next cycle can retry.
      // This explicitly does NOT permanently suppress the work.
      entry.status = "pending";
      entry.updatedAt = now();
      entry.reason = `retryable: ${reason}`;
    },

    getEntry(roundId) {
      return entries.get(roundId);
    },

    entries() {
      return [...entries.values()];
    },
  };
}