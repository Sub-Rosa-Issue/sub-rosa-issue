import type { BadgeState } from "../lib/round-status";

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
  return (
    <span className={`round-status-badge ${state}`} title={error ?? message ?? undefined}>
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
        <button type="button" className="round-status-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}

      {state === "stale" && onRetry ? (
        <button type="button" className="round-status-retry" onClick={onRetry}>
          Refresh
        </button>
      ) : null}
    </span>
  );
}
