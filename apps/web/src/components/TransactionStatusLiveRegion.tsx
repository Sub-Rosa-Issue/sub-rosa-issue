// Copyright (c) 2026 Sub Rosa contributors
import type { ActionStatus } from "../hooks/useRoundSession";

export type TransactionPhase = "idle" | "commit" | "reveal" | "settle" | "retry";

export interface TransactionAnnouncementInput {
  phase?: TransactionPhase;
  status: ActionStatus;
  roundId?: bigint | number | null;
  roundStatus?: string | null;
  committed?: boolean;
  revealedCount?: number;
  revealProgress?: { current: number; total: number } | null;
  latestMessage?: string | null;
  sealedValue?: string | number | bigint | null;
}

/**
 * Redact any raw numeric/currency value from a status string while a round is
 * still sealed (pre-reveal) so screen readers never announce confidential bids.
 */
export function redactSealedValues(text: string, sealedValue?: string | number | bigint | null): string {
  let sanitized = text;
  if (sealedValue != null && String(sealedValue).trim() !== "") {
    const raw = String(sealedValue).trim();
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(escaped, "g"), "[sealed]");
    const num = Number(raw);
    if (Number.isFinite(num)) {
      const formatted = num.toLocaleString("en-US");
      const escapedFmt = formatted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      sanitized = sanitized.replace(new RegExp(escapedFmt, "g"), "[sealed]");
    }
  }
  // Redact currency/amount patterns like "$1,250 USDC" or "1250.00 USDC"
  sanitized = sanitized.replace(
    /\$?\b\d[\d,]*(?:\.\d+)?\s*(?:USDC|XLM|stroops)\b/gi,
    "[sealed amount]",
  );
  return sanitized;
}

/**
 * Build a concise, screen-reader-safe status announcement for commit, reveal,
 * settle, and retry transitions without leaking sealed bid values.
 */
export function buildTransactionAnnouncement(input: TransactionAnnouncementInput): string {
  const {
    phase = "idle",
    status,
    roundId,
    roundStatus,
    committed = false,
    revealedCount = 0,
    revealProgress = null,
    latestMessage = null,
    sealedValue = null,
  } = input;

  const roundPrefix = roundId != null ? `Round #${String(roundId)}: ` : "";

  if (revealProgress && revealProgress.total > 0) {
    return `${roundPrefix}Revealing entry ${revealProgress.current} of ${revealProgress.total}.`;
  }

  if (phase === "retry") {
    if (status === "working") {
      return `${roundPrefix}Retrying transaction status sync.`;
    }
    if (status === "error") {
      return `${roundPrefix}Transaction failed. Check wallet and retry.`;
    }
    if (status === "ok") {
      return `${roundPrefix}Retry succeeded.`;
    }
  }

  if (phase === "settle" || roundStatus === "Settled") {
    if (status === "working") {
      return `${roundPrefix}Settling round on-chain.`;
    }
    if (status === "error") {
      return `${roundPrefix}Settlement failed. Retry available.`;
    }
    if (roundStatus === "Settled" || status === "ok") {
      return `${roundPrefix}Round settled on-chain.`;
    }
  }

  if (phase === "reveal" || roundStatus === "Revealing" || revealedCount > 0) {
    if (status === "working") {
      return `${roundPrefix}Opening Drand reveal gate and verifying entries.`;
    }
    if (status === "error") {
      return `${roundPrefix}Reveal failed. Check wallet and retry.`;
    }
    if (revealedCount > 0) {
      return `${roundPrefix}Reveal complete. ${revealedCount} ${
        revealedCount === 1 ? "entry" : "entries"
      } opened on-chain.`;
    }
  }

  if (phase === "commit" || (committed && revealedCount === 0)) {
    if (status === "working") {
      return `${roundPrefix}Sealing and submitting commitment. Sealed value hidden.`;
    }
    if (status === "error") {
      return `${roundPrefix}Commit failed. Check wallet and retry.`;
    }
    if (committed || status === "ok") {
      return `${roundPrefix}Commitment sealed on-chain. Value remains hidden until reveal.`;
    }
  }

  if (status === "working") {
    return `${roundPrefix}Transaction in progress.`;
  }

  if (status === "error") {
    const safeErr = latestMessage ? redactSealedValues(latestMessage, sealedValue) : null;
    return `${roundPrefix}${safeErr ? `Transaction error: ${safeErr}` : "Transaction failed. Check wallet and retry."}`;
  }

  if (latestMessage) {
    return `${roundPrefix}${redactSealedValues(latestMessage, sealedValue)}`;
  }

  return `${roundPrefix}Ready.`;
}

export function TransactionStatusLiveRegion(props: TransactionAnnouncementInput) {
  const announcement = buildTransactionAnnouncement(props);
  return (
    <div
      className="tx-status-live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="tx-status-live-region"
    >
      {announcement}
    </div>
  );
}
