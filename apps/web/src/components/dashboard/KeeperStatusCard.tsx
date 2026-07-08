import { shortHash } from "../../lib/format";
import type { DashboardData, KeeperDryRunPhase } from "../../dashboard/types";

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

export function KeeperStatusCard({ data }: { data: DashboardData }) {
  const { keeper } = data;

  return (
    <section className="dashboard-card keeper-status-card">
      <header className="dashboard-card-header">
        <h2>Keeper Status</h2>
        <PhaseBadge phase={keeper.currentPhase} />
      </header>

      <div className="dashboard-card-body">
        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Next Action</span>
          <span className="dashboard-kv-value">{keeper.nextAction}</span>
        </div>

        {keeper.lastActionAt && (
          <div className="dashboard-kv-row">
            <span className="dashboard-kv-label">Last Action</span>
            <span className="dashboard-kv-value">
              {new Date(keeper.lastActionAt).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
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
                      {new Date(action.timestamp).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
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
