// Copyright (c) 2026 Sub Rosa contributors
import { shortHash } from "../../lib/format";
import type { DashboardData, KeeperDryRunPhase } from "../../dashboard/types";
import type { DashboardSnapshot } from "@sub-rosa/sdk";

function PhaseBadge({ phase }: { phase: KeeperDryRunPhase }) {
  const tone =
    phase === "complete"
      ? "success"
      : phase === "stale-open"
        ? "error"
        : phase === "ready-to-clear" || phase === "ready-to-settle"
          ? "warning"
          : "info";

  const label = phase.replace(/-/g, " ");

  return <span className={`dashboard-phase-badge ${tone}`}>{label}</span>;
}

export function KeeperStatusCard({
  data,
  snapshot,
}: {
  data: DashboardData;
  snapshot: DashboardSnapshot;
}) {
  const { keeper } = data;
  // Use the shared snapshot cursor so both cards always agree on the keeper
  // phase slug.  When a keeper error is present, show the last verified phase
  // as stale rather than hiding it.
  const cursor = snapshot.keeperCursor as KeeperDryRunPhase;

  return (
    <section className="dashboard-card keeper-status-card">
      <header className="dashboard-card-header">
        <h2>Keeper Status</h2>
        <PhaseBadge phase={cursor} />
        {snapshot.keeperError && (
          <span className="dashboard-status-pill error" title={snapshot.keeperError}>
            error (stale)
          </span>
        )}
      </header>

      <div className="dashboard-card-body">
        {snapshot.keeperError && (
          <div className="dashboard-keeper-error" role="alert">
            <strong>Keeper error:</strong> {snapshot.keeperError}
          </div>
        )}

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Round ID</span>
          <span className="dashboard-kv-value">{snapshot.roundId}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Phase</span>
          <span className="dashboard-kv-value highlight">{snapshot.phase}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Next Action</span>
          <span className="dashboard-kv-value">{keeper.nextAction}</span>
        </div>

        {keeper.lastActionAt && (
          <div className="dashboard-kv-row">
            <span className="dashboard-kv-label">Last Action</span>
            <span className="dashboard-kv-value">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(Date.parse(keeper.lastActionAt))}
            </span>
          </div>
        )}

        {keeper.actionHistory.length > 0 && (
          <div className="dashboard-action-history">
            <h3>Action History</h3>
            <ul className="dashboard-action-list">
              {keeper.actionHistory.slice(0, 5).map((action, index) => (
                <li
                  key={`${action.timestamp}-${index}`}
                  className={`dashboard-action-item ${action.success ? "success" : "error"}`}
                >
                  <span className="dashboard-action-indicator">
                    {action.success ? "+" : "x"}
                  </span>
                  <div className="dashboard-action-content">
                    <span className="dashboard-action-text">{action.action}</span>
                    <span className="dashboard-action-meta">
                      {new Intl.DateTimeFormat(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(Date.parse(action.timestamp))}
                      {action.txHash && (
                        <>
                          {" · "}
                          <code className="dashboard-tx-hash">
                            {shortHash(action.txHash, 6)}
                          </code>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {keeper.actionHistory.length > 5 && (
              <p className="dashboard-action-more">
                +{keeper.actionHistory.length - 5} more actions
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
