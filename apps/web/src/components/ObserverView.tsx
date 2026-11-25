// Copyright (c) 2026 Sub Rosa contributors
import type { DemoTrace } from "../demo/trace";
import { isTraceSettled } from "../demo/trace";
import type { LiveSnapshot } from "../hooks/useLiveRound";
import { getRoundStatusInfo } from "../lib/round-status";
import { bytesToHex } from "../lib/hex";
import { classifyRoundPhase, isRevealPhase, roundStatusFromTag } from "../lib/round-phase";
import { useRevealPhase } from "../lib/use-reveal-phase";
import { shortAddr, usdc } from "../lib/format";
import { useTime } from "../lib/time";
import { RoundStatusBadge } from "./RoundStatusBadge";

/** Placeholder rendered instead of any pre-reveal bid value. */
export const SEALED_PLACEHOLDER = "sealed";
/** Masked commitment shown when the fixture carries no on-chain hash. */
const MASKED_COMMITMENT = "H=••••••••••••••••";

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
  const { clock } = useTime();
  const settled = isTraceSettled(trace);

  // When live polling is expected (Live mode) use full state detection;
  // otherwise (Evidence mode) show trace fallback as "found".
  const statusInfo = expectLive
    ? getRoundStatusInfo({
        live,
        error: liveError ?? null,
        configured: true,
        stale: livePolledAt != null && clock.nowMs() - livePolledAt > 30_000,
      })
    : { state: "found" as const, tag: trace.meta.roundStatus, message: trace.meta.roundStatus };

  const statusTag = statusInfo.state === "found" || statusInfo.state === "stale"
    ? live?.round.status.tag ?? trace.meta.roundStatus
    : null;

  const winner = live?.round.winner ?? trace.keeper.clearWinner;

  // Single phase decision shared with the dashboard: nothing bid-shaped is
  // rendered unless this says the reveal round has opened.
  const { phase, revealed } = useRevealPhase({ trace, live });

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
          {winner && revealed && (
            <p className="muted" style={{ marginTop: 8 }}>
              Winner: <code>{shortAddr(String(winner), 8)}</code>
            </p>
          )}
        </div>
        <div className="card">
          <h3>Sealed phase</h3>
          <p>
            {phase === "Settled"
              ? "Round complete — bids were sealed until Drand R, then revealed for all."
              : phase === "Reveal"
                ? "Drand R is public — sealed bids are being revealed. Values appear as the contract accepts them."
                : "Commitments H and escrow are public. Ciphertext is on-chain but undecryptable until Drand R."}
          </p>
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

            // Phase-gated reveal: before the reveal round opens, show only the
            // commitment hash — never the fixture amount or the winner mark.
            // The fixture trace carries no hash, so the commitment renders
            // masked rather than fabricated.
            const commitLabel = liveSt?.commitment
              ? `H=${bytesToHex(new Uint8Array(liveSt.commitment)).slice(0, 16)}…`
              : MASKED_COMMITMENT;

            const revealedNow = revealed && (liveSt?.revealed_value != null || !live);

            const valueLabel = revealedNow
              ? liveSt?.revealed_value != null
                ? usdc(Number(liveSt.revealed_value) / 1e7)
                : b.bidUsdc != null
                  ? usdc(b.bidUsdc)
                  : "—"
              : SEALED_PLACEHOLDER;

            const validLabel = revealedNow
              ? liveSt
                ? liveSt.valid
                  ? "yes"
                  : "no"
                : b.valid
                  ? "yes"
                  : "no"
              : "—";

            return (
              <tr key={b.address}>
                <td>
                  <strong>{b.label}</strong>
                  <br />
                  <code className="tiny">{shortAddr(b.address, 10)}</code>
                </td>
                <td>{usdc(b.escrowUsdc)}</td>
                <td>
                  {revealedNow ? (
                    valueLabel
                  ) : (
                    <>
                      <code className="tiny">{commitLabel}</code>{" "}
                      <span className="muted tiny">{SEALED_PLACEHOLDER}</span>
                    </>
                  )}
                </td>
                <td>{validLabel}</td>
                <td>{revealedNow && b.winner ? "✓" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// Re-exported helpers keep the phase predicates importable from the view
// module for tests without widening the shared helper's public surface.
export { classifyRoundPhase, isRevealPhase, roundStatusFromTag };
