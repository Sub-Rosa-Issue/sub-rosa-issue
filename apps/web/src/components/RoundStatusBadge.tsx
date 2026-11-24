// Copyright (c) 2026 Sub Rosa contributors
import { useState } from "react";
import { TransactionStatusAnnouncer } from "./TransactionStatusAnnouncer";
import type { BadgeState } from "../lib/round-status";
import { transactionStatusAnnouncement } from "../lib/transaction-status";

export interface RoundStatusBadgeProps {
  state: BadgeState;
  tag?: string | null;
  message?: string | null;
  error?: string | null;
  onRetry?: () => void;
}

const STATE_LABEL: Record<BadgeState, string> = {
  loading: "Loading",
  empty: "Empty",
  error: "Error",
  stale: "Stale",
  found: "Live",
};

export function RoundStatusBadge({
  state,
  tag,
  message,
  error,
  onRetry,
}: RoundStatusBadgeProps) {
  const [retryMessage, setRetryMessage] = useState("");

  function retry() {
    setRetryMessage(transactionStatusAnnouncement("retry", "working"));
    onRetry?.();
  }

  return (
    <span
      className={`round-status-badge ${state}`}
      role={state === "error" ? "alert" : "status"}
      aria-busy={state === "loading"}
      title={error ?? message ?? undefined}
    >
      {state === "loading" ? (
        <span className="round-status-spinner" aria-hidden="true" />
      ) : null}
      {state === "error" ? (
        <span className="round-status-icon" aria-hidden="true">!</span>
      ) : null}
      {state === "stale" ? (
        <span className="round-status-icon" aria-hidden="true">~</span>
      ) : null}

      <span className="round-status-label">{STATE_LABEL[state]}</span>

      {tag ? (
        <span className="round-status-tag">{tag}</span>
      ) : null}

      {error ? (
        <span className="round-status-err">{error}</span>
      ) : null}

      {state === "error" && onRetry ? (
        <button type="button" className="round-status-retry" onClick={retry}>
          Retry
        </button>
      ) : null}

      {state === "stale" && onRetry ? (
        <button type="button" className="round-status-retry" onClick={retry}>
          Refresh
        </button>
      ) : null}
      <TransactionStatusAnnouncer message={retryMessage} />
    </span>
  );
}
