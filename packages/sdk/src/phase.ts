export type RoundPhase = "setup" | "commit" | "reveal/settle" | "closed" | "unknown";

export interface RoundLike {
  status: {
    tag: string;
  };
  commit_deadline: bigint | number | string;
  reveal_deadline: bigint | number | string;
}

function toBigIntSafe(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || Number.isNaN(v)) return null;
    return BigInt(Math.floor(v));
  }
  if (typeof v === "string") {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Classifies the active phase of a Sub Rosa round based on its contract state
 * and a ledger timestamp (or clock clock).
 *
 * @param round Struct resembling a Round contract status tag and deadlines. Pass null/undefined for setup phase.
 * @param ledgerTimestamp Current ledger timestamp (unix seconds).
 */
export function classifyRoundPhase(
  round: RoundLike | null | undefined,
  ledgerTimestamp: bigint | number | string
): RoundPhase {
  // 1. Setup Phase: Round not created yet
  if (!round) {
    return "setup";
  }

  // 2. Validate Ledger Timestamp
  const ts = toBigIntSafe(ledgerTimestamp);
  if (ts === null || ts < 0n) {
    return "unknown";
  }

  // Validate Status Tag
  const status = round.status?.tag;
  if (typeof status !== "string") {
    return "unknown";
  }

  const VALID_STATUSES = new Set(["Open", "Revealing", "Cleared", "Settled", "Voided"]);
  if (!VALID_STATUSES.has(status)) {
    return "unknown";
  }

  // 3. Closed Phase: Finalized states
  if (status === "Settled" || status === "Voided") {
    return "closed";
  }

  // Validate Deadlines
  const commitDeadline = toBigIntSafe(round.commit_deadline);
  const revealDeadline = toBigIntSafe(round.reveal_deadline);
  if (commitDeadline === null || revealDeadline === null || commitDeadline < 0n || revealDeadline < 0n) {
    return "unknown";
  }

  // 4. Commit Phase: Open status and before/at commit deadline
  if (status === "Open" && ts <= commitDeadline) {
    return "commit";
  }

  // 5. Reveal/Settle Phase:
  // - Open status and commit window is closed (awaiting reveal)
  // - Revealing status (within reveal window or after it, before clearing)
  // - Cleared status (winner computed, awaiting settlement)
  if (
    (status === "Open" && ts > commitDeadline) ||
    status === "Revealing" ||
    status === "Cleared"
  ) {
    return "reveal/settle";
  }

  return "unknown";
}
