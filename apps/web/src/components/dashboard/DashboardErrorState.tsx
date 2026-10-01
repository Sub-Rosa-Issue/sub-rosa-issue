// Copyright (c) 2026 Sub Rosa contributors
import { SDK_ERROR_CODES, type SdkErrorCode } from "@sub-rosa/sdk";

// The only input is an SDK error code. This component deliberately accepts no
// message, round, or bid object, so a failed load has nothing sealed to render.
export function DashboardErrorState({
  code,
  onRetry,
}: {
  code: SdkErrorCode;
  onRetry: () => void;
}) {
  // Re-check against the closed set so an untyped caller cannot pass free text.
  const safeCode: SdkErrorCode = SDK_ERROR_CODES.includes(code) ? code : "UNKNOWN";

  return (
    <div className="dashboard-error-state" role="alert">
      <div className="dashboard-error-icon">
        <svg
          aria-hidden="true"
          focusable="false"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <h2>Failed to Load Dashboard</h2>
      <p className="dashboard-error-message">
        The dashboard could not load round data. Error code: <code>{safeCode}</code>
      </p>
      <button type="button" className="primary-action" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
