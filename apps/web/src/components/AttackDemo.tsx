import { publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { useState } from "react";
import type { AttackStep } from "../lib/demoTypes";
import { useToast } from "../ui/Toast";

export function StepList({ steps, variant }: { steps: AttackStep[]; variant: "bad" | "good" }) {
  const listLabel = variant === "bad" ? "Seal-off attack steps" : "Seal-on protection steps";
  return (
    <ul className={`attack-steps ${variant}`} aria-label={listLabel}>
      {steps.map((s) => (
        <li key={s.label} className={s.ok ? "ok" : "fail"}>
          <span className="attack-mark" aria-hidden="true">{s.ok ? "✓" : "✗"}</span>
          <div>
            <strong>{s.label}</strong>
            <p>{s.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The leaky "seal off" column body — withheld until the reveal round opens. */
export function SealOffColumn({
  steps,
  revealOpen,
}: {
  steps: AttackStep[] | null;
  revealOpen: boolean;
}) {
  if (steps && revealOpen) return <StepList steps={steps} variant="bad" />;
  if (steps) {
    return (
      <p className="placeholder">
        Bids still sealed — values hidden until Drand R opens the reveal round.
      </p>
    );
  }
  return <p className="placeholder">Run demo</p>;
}

export function AttackDemo({ phase = "Reveal" }: { phase?: "Open" | "Reveal" | "Settled" }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [sealOff, setSealOff] = useState<AttackStep[] | null>(null);
  const [sealOn, setSealOn] = useState<AttackStep[] | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const workingId = toast.push("working", "Running tlock comparison…");
    setLoading(true);
    setErr(null);
    try {
      const { runSealAttackDemo } = await import("../lib/demoActions");
      const res = await runSealAttackDemo();
      setSealOff(res.sealOff);
      setSealOn(res.sealOn);
      setRound(res.revealRound);
      toast.dismiss(workingId);
      toast.push(
        "success",
        "Attack demo complete",
        `Seal-off leaks early · seal-on waits for R=${res.revealRound.toLocaleString()}`,
      );
    } catch (e) {
      const msg = publicErrorMessage(e);
      setErr(msg);
      toast.dismiss(workingId);
      toast.push("error", "Attack demo failed", msg);
    } finally {
      setLoading(false);
    }
  }

  // The demo never renders a revealed value while the shared round-phase
  // helper says the reveal round is still sealed — regardless of what the
  // attack steps computed. Seal-on columns stay visible (they only ever show
  // the commitment hash and step status); the seal-off column, which exists
  // to leak, is withheld until the phase says reveal has opened.
  const revealOpen = phase !== "Open";

  return (
    <section className="panel attack-panel" aria-label="Seal-off vs seal-on attack">
      <header className="panel-head attack-head">
        <div>
          <p className="eyebrow">Main stage</p>
          <h2>Seal-off vs seal-on attack</h2>
        </div>
        <p>
          Live tlock against Drand quicknet. The broken baseline reveals early;
          Sub Rosa waits for R and force-opens all bids.
        </p>
      </header>

      <div className="attack-control">
        <button
          type="button"
          className="btn primary"
          onClick={run}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Running live tlock demo..." : "Run live attack comparison"}
        </button>
        {round != null && (
          <p className="muted">Sealed to future Drand round R={round.toLocaleString()}</p>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>

      <div className="attack-columns">
        <div className="attack-col bad" role="region" aria-label="Seal OFF — broken commit-reveal">
          <h3>Seal OFF — broken commit-reveal</h3>
          <p className="attack-sub">
            Bid stored in reversible form. Observer reads early. Losing bidder can abort.
          </p>
          <SealOffColumn steps={sealOff} revealOpen={revealOpen} />
        </div>
        <div className="attack-col good" role="region" aria-label="Seal ON — Sub Rosa + Drand tlock">
          <h3>Seal ON — Sub Rosa + Drand tlock</h3>
          <p className="attack-sub">
            Undecryptable until R. Permissionless mass reveal. Commitment binding on-chain.
          </p>
          {sealOn ? <StepList steps={sealOn} variant="good" /> : <p className="placeholder">Run demo</p>}
        </div>
      </div>
    </section>
  );
}
