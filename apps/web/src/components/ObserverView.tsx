import type { DemoTrace } from "../demo/trace";
import type { LiveSnapshot } from "../hooks/useLiveRound";
import { getRoundStatusInfo } from "../lib/round-status";
import { shortAddr, usdc } from "../lib/format";
import { RoundStatusBadge } from "./RoundStatusBadge";
import { DrandCountdownChip } from "./DrandCountdownChip";

function classifyJuryPhase(lifecycle: DemoTrace["lifecycle"]): {
  phase: "Open" | "Reveal" | "Settled";
  label: string;
  color: string;
} {
  const active = lifecycle.find((s) => s.status === "active");
  if (!active) return { phase: "Settled", label: "Settled", color: "var(--green)" };

  switch (active.phase) {
    case "open_reveal":
    case "reveal_all":
    case "clear":
      return { phase: "Reveal", label: "Reveal", color: "var(--orange)" };
    case "settle":
      return { phase: "Settled", label: "Settled", color: "var(--green)" };
    default:
      return { phase: "Open", label: "Open", color: "var(--blue)" };
  }
}

export function ObserverView({
  trace,
  live,
  liveError,
  livePolledAt,
  expectLive,
  onRefresh,
}: {
  trace: DemoTrace;
  live: LiveSnapshot | null;
  liveError?: string | null;
  livePolledAt?: number | null;
  expectLive?: boolean;
  onRefresh?: () => void;
}) {
  // When live polling is expected (Live mode) use full state detection;
  // otherwise (Evidence mode) show trace fallback as "found".
  const statusInfo = expectLive
    ? getRoundStatusInfo({
        live,
        error: liveError ?? null,
        configured: true,
        stale: livePolledAt != null && Date.now() - livePolledAt > 30_000,
      })
    : { state: "found" as const, tag: trace.meta.roundStatus, message: trace.meta.roundStatus };

  const statusTag = statusInfo.state === "found" || statusInfo.state === "stale"
    ? live?.round.status.tag ?? trace.meta.roundStatus
    : null;

  const winner = live?.round.winner ?? trace.keeper.clearWinner;
  const juryPhase = classifyJuryPhase(trace.lifecycle);
  const targetRound = trace.meta.revealRound;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Observer view</h2>
        <p>Public ledger state — what anyone can see without keys.</p>
      </header>

      <div className="observer-grid">
        <div className="card">
          <h3>Round status</h3>
          <RoundStatusBadge
            state={statusInfo.state}
            tag={statusTag}
            message={statusInfo.message}
            error={statusInfo.state === "error" ? statusInfo.message : undefined}
            onRetry={onRefresh}
          />
          {winner && (
            <p className="muted" style={{ marginTop: 8 }}>
              Winner: <code>{shortAddr(String(winner), 8)}</code>
            </p>
          )}
        </div>
        <div className="card">
          <h3>
            Phase
            <span
              className="jury-phase-badge"
              style={{
                display: "inline-block",
                marginLeft: 8,
                padding: "2px 10px",
                borderRadius: 12,
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: juryPhase.color + "20",
                color: juryPhase.color,
                border: `1px solid ${juryPhase.color}40`,
              }}
            >
              {juryPhase.phase === "Open" ? "🔓" : juryPhase.phase === "Reveal" ? "👁" : "✅"}{" "}
              {juryPhase.label}
            </span>
          </h3>
          <p>
            {juryPhase.phase === "Settled"
              ? "Round complete — bids were sealed until Drand R, then revealed for all."
              : juryPhase.phase === "Reveal"
                ? "Commitments are open. Bid values are being revealed on-chain."
                : "Commitments H and escrow are public. Ciphertext is on-chain but undecryptable until Drand R."}
          </p>
        </div>
        <div className="card">
          <h3>Countdown</h3>
          {targetRound ? (
            <DrandCountdownChip
              targetRound={targetRound}
              mode={juryPhase.phase === "Settled" ? "idle" : "live-round"}
            />
          ) : (
            <p className="muted">No Drand round configured for this trace.</p>
          )}
        </div>
        <div className="card">
          <h3>After reveal</h3>
          <p>Bid values are public. Bidder identities remain auditor-encrypted until opened.</p>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Bidder</th>
            <th>Escrow</th>
            <th>Revealed bid</th>
            <th>Valid</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          {trace.bidders.map((b) => {
            const liveSt = live?.bidStates[b.address];
            const revealed =
              liveSt?.revealed_value != null
                ? Number(liveSt.revealed_value) / 1e7
                : b.bidUsdc;
            return (
              <tr key={b.address}>
                <td>
                  <strong>{b.label}</strong>
                  <br />
                  <code className="tiny">{shortAddr(b.address, 10)}</code>
                </td>
                <td>{usdc(b.escrowUsdc)}</td>
                <td>{revealed != null ? usdc(revealed) : "—"}</td>
                <td>{liveSt ? (liveSt.valid ? "yes" : "no") : b.valid ? "yes" : "no"}</td>
                <td>{b.winner ? "✓" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
