// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { validatePublicConfig, type ConfigIssue, type DemoActionGate } from "../lib/config";

const BANNER_STORAGE_KEY = "subrosa-config-banner-dismissed";

export function ConfigBanner({ gate }: { gate?: DemoActionGate } = {}) {
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIssues(validatePublicConfig());
    try {
      const stored = globalThis.sessionStorage?.getItem(BANNER_STORAGE_KEY);
      if (stored === "1") setDismissed(true);
    } catch {
      // Keep the banner usable when browser storage is blocked.
    }
  }, []);

  // A blocking gate is always shown: the actions are disabled, so the reason must stay visible.
  const blocked = gate != null && !gate.enabled;
  const shown = [...(blocked ? gate.issues : []), ...issues].filter(
    (issue, index, all) => all.findIndex((other) => other.message === issue.message) === index,
  );
  if (shown.length === 0 || (dismissed && !blocked)) return null;

  return (
    <aside className="config-banner" role="alert">
      <div className="config-banner-body">
        <span className="config-banner-icon" aria-hidden="true">!</span>
        <div className="config-banner-content">
          <strong>
            {blocked ? "Demo actions disabled — public config needs attention" : "Public config needs attention"}
          </strong>
          <ul>
            {shown.map((issue) => (
              <li key={`${issue.key}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      </div>
      {!blocked && <button
        type="button"
        className="config-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            globalThis.sessionStorage?.setItem(BANNER_STORAGE_KEY, "1");
          } catch {
            // Dismissal still applies to the current mounted banner.
          }
        }}
      >
        &times;
      </button>}
    </aside>
  );
}
