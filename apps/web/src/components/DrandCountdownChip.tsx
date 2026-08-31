// Copyright (c) 2026 Sub Rosa contributors
import { formatCountdown, useDrandCountdown } from "../hooks/useDrandCountdown";

type ChipMode = "live-round" | "proof" | "idle";

export function DrandCountdownChip({
  targetRound,
  mode = "idle",
}: {
  /** Drand reveal round to count down to. Omit in idle mode. */
  targetRound?: number | null;
  mode?: ChipMode;
}) {
  if (mode === "idle") {
    return (
      <div className="drand-footer idle" title="Drand quicknet — randomness beacon for sealed reveals">
        <span className="drand-dot" aria-hidden="true" />
        <div className="drand-footer-copy">
          <strong>Drand quicknet</strong>
          <small>Beacon ready</small>
        </div>
      </div>
    );
  }

  if (targetRound == null) return null;

  return <DrandCountdownBody targetRound={targetRound} mode={mode} />;
}

function DrandCountdownBody({
  targetRound,
  mode,
}: {
  targetRound: number;
  mode: "live-round" | "proof";
}) {
  const drand = useDrandCountdown(targetRound);

  if (drand.loading) {
    return (
      <div className="drand-footer syncing" title="Syncing Drand quicknet">
        <span className="drand-dot" aria-hidden="true" />
        <div className="drand-footer-copy">
          <strong>{mode === "proof" ? "Proof beacon" : "Round reveal"}</strong>
          <small>Syncing R…</small>
        </div>
      </div>
    );
  }

  if (drand.error) {
    return (
      <div className="drand-footer warn" title={drand.error}>
        <span className="drand-dot" aria-hidden="true" />
        <div className="drand-footer-copy">
          <strong>Drand offline</strong>
          <small>Could not reach quicknet</small>
        </div>
      </div>
    );
  }

  if (drand.published) {
    return (
      <div
        className="drand-footer published"
        title={`Drand R=${targetRound.toLocaleString()} is published — reveal is unlocked`}
      >
        <span className="drand-dot" aria-hidden="true" />
        <div className="drand-footer-copy">
          <strong>{mode === "proof" ? "Proof R live" : "Reveal unlocked"}</strong>
          <small>R {targetRound.toLocaleString()} · beacon published</small>
        </div>
      </div>
    );
  }

  return (
    <div
      className="drand-footer waiting"
      title={`Estimated ${formatCountdown(drand.secondsRemaining)} until R=${targetRound}`}
    >
      <span className="drand-dot" aria-hidden="true" />
      <div className="drand-footer-copy">
        <strong>{formatCountdown(drand.secondsRemaining)}</strong>
        <small>
          {mode === "proof" ? "Until proof R" : "Until round reveal"} · R{" "}
          {targetRound.toLocaleString()}
        </small>
      </div>
    </div>
  );
}
