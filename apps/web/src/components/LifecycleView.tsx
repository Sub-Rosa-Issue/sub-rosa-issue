// Copyright (c) 2026 Sub Rosa contributors
import type { DemoTrace } from "../demo/trace";
import { formatCountdown, useDrandCountdown } from "../hooks/useDrandCountdown";
import { phaseIcon, usdc } from "../lib/format";

function DrandRevealBanner({ revealRound }: { revealRound: number }) {
  const drand = useDrandCountdown(revealRound);

  return (
    <div className={`drand-banner ${drand.published ? "published" : "waiting"}`}>
      <span>Drand reveal round</span>
      <strong>R = {revealRound.toLocaleString()}</strong>
      {drand.loading ? (
        <em>syncing quicknet…</em>
      ) : drand.published ? (
        <em>published — bids can open</em>
      ) : (
        <em>~{formatCountdown(drand.secondsRemaining)} until R</em>
      )}
    </div>
  );
}

export function LifecycleView({ trace }: { trace: DemoTrace }) {
  return (
    <section className="panel lifecycle-panel">
      <header className="panel-head cinematic-head">
        <div>
          <p className="eyebrow">Cinematic lifecycle</p>
          <h2>One sealed round, opened for everyone at once.</h2>
        </div>
        <p>
          Contract <code>{trace.meta.contractId.slice(0, 8)}...</code> / round{" "}
          {trace.meta.roundId} / {trace.meta.clearingRule}
        </p>
      </header>

      <DrandRevealBanner revealRound={trace.meta.revealRound} />

      <ol className="lifecycle">
        {trace.lifecycle.map((step, index) => (
          <li key={step.phase} className={`lifecycle-step ${step.status}`}>
            <span className="lifecycle-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="lifecycle-icon">{phaseIcon(step.status)}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Operator received</span>
          <span className="stat-value">{usdc(trace.settlement.operatorReceivedUsdc)} USDC</span>
        </div>
        <div className="stat">
          <span className="stat-label">Refunds</span>
          <span className="stat-value">{usdc(trace.settlement.refundsUsdc)} USDC</span>
        </div>
        <div className="stat">
          <span className="stat-label">Contract balance</span>
          <span className="stat-value accent">{trace.keeper.contractBalanceFinal} USDC</span>
        </div>
      </div>
    </section>
  );
}
