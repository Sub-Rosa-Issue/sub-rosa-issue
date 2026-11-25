// Copyright (c) 2026 Sub Rosa contributors
import type { RoundStatus } from "@sub-rosa/sdk";
import { phaseIcon } from "../lib/format";
import { lifecycleStepFromStatus, type LifecycleStep } from "../lib/round-phase";

// ---------------------------------------------------------------------------
// Static step definitions — labels and details never change with phase.
// ---------------------------------------------------------------------------

interface StepDef {
  key: LifecycleStep;
  label: string;
  detail: string;
}

const STEPS: StepDef[] = [
  {
    key: "commit",
    label: "Commit",
    detail: "Bidders lock escrow and submit a sealed (tlock-encrypted) bid.",
  },
  {
    key: "reveal",
    label: "Reveal",
    detail:
      "Drand publishes round R. The keeper submits the BLS signature; the contract verifies on-chain and decrypts all bids simultaneously.",
  },
  {
    key: "settle",
    label: "Settle",
    detail:
      "Contract clears the winner, pays the operator, and refunds all other bidders. Balance returns to zero.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepStatus(
  key: LifecycleStep,
  activeStep: LifecycleStep | null,
): "done" | "active" | "pending" {
  if (activeStep === null) return "pending";
  const activeIndex = STEPS.findIndex((s) => s.key === activeStep);
  const thisIndex = STEPS.findIndex((s) => s.key === key);
  if (thisIndex < activeIndex) return "done";
  if (thisIndex === activeIndex) return "active";
  return "pending";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LifecycleViewProps {
  /** SDK RoundStatus — the single source of truth for which step is active. */
  status: RoundStatus;
}

export function LifecycleView({ status }: LifecycleViewProps) {
  const { step, error, settleDisabled } = lifecycleStepFromStatus(status);

  if (error) {
    return (
      <section className="panel lifecycle-panel" data-testid="lifecycle-error">
        <header className="panel-head">
          <p className="eyebrow">Lifecycle</p>
          <h2>Round phase unknown</h2>
        </header>
        <p className="lifecycle-error-message">
          The round status reported by the keeper is{" "}
          <strong>{status}</strong>. This may mean the round was never created
          on-chain or the keeper has not yet resolved it. Check the contract ID
          and round ID.
        </p>
      </section>
    );
  }

  return (
    <section className="panel lifecycle-panel">
      <header className="panel-head cinematic-head">
        <p className="eyebrow">Cinematic lifecycle</p>
        <h2>One sealed round, opened for everyone at once.</h2>
      </header>

      <ol className="lifecycle">
        {STEPS.map((def, index) => {
          const status = stepStatus(def.key, step);
          const isSettleDisabledStep = def.key === "settle" && settleDisabled;
          return (
            <li
              key={def.key}
              className={`lifecycle-step ${status}${isSettleDisabledStep ? " disabled" : ""}`}
              aria-disabled={isSettleDisabledStep ? "true" : undefined}
              data-step={def.key}
              data-status={status}
            >
              <span className="lifecycle-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="lifecycle-icon">{phaseIcon(status)}</span>
              <div>
                <strong>{def.label}</strong>
                <p>{def.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
