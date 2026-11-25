// Copyright (c) 2026 Sub Rosa contributors

/**
 * Polite announcements for async demo transactions.
 *
 * The text is chosen only from the phase and outcome. It never accepts a bid
 * amount, ciphertext, or commitment, so a live region cannot read a sealed
 * value aloud. Commit, reveal, settle, and retry each have working, success,
 * and error sentences.
 */
export const TRANSACTION_PHASES = ["commit", "reveal", "settle", "retry"] as const;
export type TransactionPhase = (typeof TRANSACTION_PHASES)[number];
export type TransactionAnnouncementState = "working" | "success" | "error";

const LEAD: Record<TransactionPhase, Record<TransactionAnnouncementState, string>> = {
  commit: {
    working: "Commit in progress.",
    success: "Commit finished.",
    error: "Commit failed.",
  },
  reveal: {
    working: "Reveal in progress.",
    success: "Reveal finished.",
    error: "Reveal failed.",
  },
  settle: {
    working: "Settlement in progress.",
    success: "Settlement finished.",
    error: "Settlement failed.",
  },
  retry: {
    working: "Retrying the transaction status.",
    success: "Transaction status refreshed.",
    error: "Retry failed.",
  },
};

export function transactionStatusAnnouncement(
  phase: TransactionPhase,
  state: TransactionAnnouncementState,
): string {
  return `${LEAD[phase][state]} Sealed bid values are not announced.`;
}
