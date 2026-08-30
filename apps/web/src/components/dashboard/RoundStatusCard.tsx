// Copyright (c) 2026 Sub Rosa contributors
import { useDrandCountdown, formatCountdown } from "../../hooks/useDrandCountdown";
import { shortAddr } from "../../lib/format";
import { classifyRoundPhase, type RoundPhase } from "../../lib/round-phase";
import { useTime } from "../../lib/time";
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

function PhasePill({ phase }: { phase: RoundPhase }) {
  const tone =
    phase === "Settled" ? "success" : phase === "Reveal" ? "warning" : "info";

  return <span className={`dashboard-phase-badge ${tone}`}>{phase}</span>;
}

function DeadlineRow({
  label,
  deadline,
  isPast,
  nowSeconds,
}: {
  label: string;
  deadline: number;
  isPast: boolean;
  nowSeconds: number;
}) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(deadline * 1000);
  const remaining = deadline - nowSeconds;

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
  const { clock } = useTime();
  const drand = useDrandCountdown(data.round.revealRound);
  const now = clock.nowSeconds();
  const commitPast = now > data.round.commitDeadline;
  const revealPast = now > data.round.revealDeadline;
  const phase = classifyRoundPhase({
    status: data.round.status,
    drandPublished: drand.published,
  });
  const drandDetail = drand.published
    ? `R ${data.round.revealRound.toLocaleString()} has already published`
    : `${formatCountdown(drand.secondsRemaining)} until R ${data.round.revealRound.toLocaleString()}`;

  return (
    <section className="dashboard-card round-status-card">
      <header className="dashboard-card-header">
        <h2>Round Status</h2>
        <div className="dashboard-card-badges">
          <PhasePill phase={phase} />
          <StatusPill status={data.round.status} />
        </div>
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
          <span className="dashboard-kv-label">Phase</span>
          <span className="dashboard-kv-value highlight">{phase}</span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Drand Round</span>
          <span className="dashboard-kv-value">
            R = {data.round.revealRound.toLocaleString()}
            {drand.published ? (
              <em className="dashboard-drand-status published"> (published)</em>
            ) : drand.loading ? (
              <em className="dashboard-drand-status"> (syncing...)</em>
            ) : (
              <em className="dashboard-drand-status">
                {" "}
                (~{formatCountdown(drand.secondsRemaining)} until R)
              </em>
            )}
          </span>
        </div>

        <div className="dashboard-kv-row">
          <span className="dashboard-kv-label">Reveal countdown</span>
          <span className="dashboard-kv-value">{drandDetail}</span>
        </div>

        <div className="dashboard-deadlines">
          <DeadlineRow
            label="Commit deadline"
            deadline={data.round.commitDeadline}
            isPast={commitPast}
            nowSeconds={now}
          />
          <DeadlineRow
            label="Reveal deadline"
            deadline={data.round.revealDeadline}
            isPast={revealPast}
            nowSeconds={now}
          />
        </div>
      </div>
    </section>
  );
}
