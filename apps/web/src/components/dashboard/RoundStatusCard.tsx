import { useDrandCountdown, formatCountdown } from "../../hooks/useDrandCountdown";
import { shortAddr } from "../../lib/format";
import type { DashboardData, RoundStatus } from "../../dashboard/types";

function StatusPill({ status }: { status: RoundStatus }) {
  const tone =
    status === "Settled"
      ? "success"
      : status === "Voided"
        ? "error"
        : status === "Open"
          ? "info"
          : "warning";

  return <span className={`dashboard-status-pill ${tone}`}>{status}</span>;
}

function DeadlineRow({
  label,
  deadline,
  isPast,
}: {
  label: string;
  deadline: number;
  isPast: boolean;
}) {
  const date = new Date(deadline * 1000);
  const formatted = date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const now = Math.floor(Date.now() / 1000);
  const remaining = deadline - now;

  return (
    <div className="dashboard-deadline-row">
      <span className="dashboard-deadline-label">{label}</span>
      <span className="dashboard-deadline-value">
        {formatted}
        {!isPast && remaining > 0 && (
          <em className="dashboard-deadline-countdown">
            (~{formatCountdown(remaining)} remaining)
          </em>
        )}
      </span>
    </div>
  );
}

export function RoundStatusCard({ data }: { data: DashboardData }) {
  const drand = useDrandCountdown(data.round.revealRound);
  const now = Math.floor(Date.now() / 1000);
  const commitPast = now > data.round.commitDeadline;
  const revealPast = now > data.round.revealDeadline;

  return (
    <section className="dashboard-card round-status-card">
      <header className="dashboard-card-header">
        <h2>Round Status</h2>
        <StatusPill status={data.round.status} />
      </header>

      <div className="dashboard-card-body">
        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Contract</span>
          <code className="dashboard-kv-value truncate">
            {shortAddr(data.meta.contractId, 8)}
          </code>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Round ID</span>
          <span className="dashboard-kv-value">{data.meta.roundId}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Network</span>
          <span className="dashboard-kv-value">{data.meta.network}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Clearing Rule</span>
          <span className="dashboard-kv-value">{data.meta.clearingRule}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Drand Round</span>
          <span className="dashboard-kv-value">
            R = {data.round.revealRound.toLocaleString()}
            {drand.loading ? (
              <em className="dashboard-drand-status"> (syncing...)</em>
            ) : drand.published ? (
              <em className="dashboard-drand-status published"> (published)</em>
            ) : (
              <em className="dashboard-drand-status">
                {" "}
                (~{formatCountdown(drand.secondsRemaining)} until R)
              </em>
            )}
          </span>
        </div>

        <div className="dashboard-deadlines">
          <DeadlineRow
            label="Commit deadline"
            deadline={data.round.commitDeadline}
            isPast={commitPast}
          />
          <DeadlineRow
            label="Reveal deadline"
            deadline={data.round.revealDeadline}
            isPast={revealPast}
          />
        </div>
      </div>
    </section>
  );
}
