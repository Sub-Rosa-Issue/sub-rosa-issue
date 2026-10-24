// Copyright (c) 2026 Sub Rosa contributors
export type TransactionLifecycleAction =
  | "commit"
  | "reveal"
  | "settle"
  | "retry"
  | "idle";

export type TransactionActionState = "idle" | "working" | "ok" | "error";

export interface TransactionAnnouncementInput {
  action: TransactionLifecycleAction;
  state: TransactionActionState;
  roundId?: bigint | number | null;
  revealedCount?: number;
  revealProgress?: { current: number; total: number } | null;
  revealed?: boolean;
  detail?: string | null;
}

const SEALED_AMOUNT_RE =
  /(?:\$\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:USDC|XLM|stroops|pts|bps|%)\b|(?:bid|value|entry|amount|escrow)\s*[:=]\s*\$?\d[\d,.]*(?:\s*(?:USDC|XLM|stroops))?)/gi;

/**
 * Strips any numeric bid/escrow value from status copy while the round is
 * still sealed (`revealed === false`). Once the Drand reveal gate has opened
 * (`revealed === true`), public revealed counts and outcomes are preserved.
 */
export function sanitizeSealedAnnouncement(
  message: string,
  options: { revealed?: boolean } = {},
): string {
  if (options.revealed) {
    return message;
  }
  return message.replace(SEALED_AMOUNT_RE, "[sealed value]");
}

export function formatTransactionAnnouncement(
  input: TransactionAnnouncementInput,
): string {
  const {
    action,
    state,
    roundId = null,
    revealedCount = 0,
    revealProgress = null,
    revealed = false,
    detail = null,
  } = input;
  const roundLabel = roundId == null ? "current round" : `round #${roundId}`;
  const safeDetail = detail ? sanitizeSealedAnnouncement(detail, { revealed }) : null;

  if (action === "commit") {
    if (state === "working") {
      return `Submitting sealed commitment for ${roundLabel} — bid value hidden until Drand reveal.`;
    }
    if (state === "ok") {
      return `Commitment recorded on-chain for ${roundLabel} — bid value remains sealed until Drand reveal.`;
    }
    if (state === "error") {
      return safeDetail
        ? `Commit failed for ${roundLabel}: ${safeDetail}`
        : `Commit failed for ${roundLabel} — check wallet and retry.`;
    }
  }

  if (action === "reveal") {
    if (state === "working") {
      if (revealProgress) {
        return `Revealing bid ${revealProgress.current} of ${revealProgress.total} for ${roundLabel}…`;
      }
      return `Opening Drand reveal gate and verifying bids for ${roundLabel}…`;
    }
    if (state === "ok") {
      return `Reveal complete for ${roundLabel} — ${revealedCount} ${revealedCount === 1 ? "entry" : "entries"} opened on-chain.`;
    }
    if (state === "error") {
      return safeDetail
        ? `Reveal failed for ${roundLabel}: ${safeDetail}`
        : `Reveal failed for ${roundLabel} — check connection and retry.`;
    }
  }

  if (action === "settle") {
    if (state === "working") {
      return `Submitting settlement transaction for ${roundLabel}…`;
    }
    if (state === "ok") {
      return `Settlement complete on-chain for ${roundLabel}.`;
    }
    if (state === "error") {
      return safeDetail
        ? `Settlement failed for ${roundLabel}: ${safeDetail}`
        : `Settlement failed for ${roundLabel} — retry available.`;
    }
  }

  if (action === "retry") {
    if (state === "working") {
      return `Retrying status check for ${roundLabel}…`;
    }
    if (state === "ok") {
      return `Status refreshed for ${roundLabel}.`;
    }
    if (state === "error") {
      return safeDetail
        ? `Retry failed for ${roundLabel}: ${safeDetail}`
        : `Retry failed for ${roundLabel} — try again.`;
    }
  }

  if (safeDetail) {
    return safeDetail;
  }
  return `Transaction status ready for ${roundLabel}.`;
}

export function TransactionStatusAnnouncer(props: TransactionAnnouncementInput) {
  const announcement = formatTransactionAnnouncement(props);
  return (
    <div
      className="tx-status-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </div>
  );
}
