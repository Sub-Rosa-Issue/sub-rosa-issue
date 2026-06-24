import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AgentActivity, KeeperPanel, X402Logs } from "../components/AgentPanels";
import { AttackDemo } from "../components/AttackDemo";
import { AuditorView } from "../components/AuditorView";
import { CohortPanel } from "../components/CohortPanel";
import { DrandCountdownChip } from "../components/DrandCountdownChip";
import { LifecycleView } from "../components/LifecycleView";
import { MainnetProofCard } from "../components/MainnetProofCard";
import { MandateCapLab } from "../components/MandateCapLab";
import { ObserverView } from "../components/ObserverView";
import { OutcomePanel } from "../components/OutcomePanel";
import { SettlementRail } from "../components/SettlementRail";
import type { UseCase, UseCaseId } from "../config/useCases";
import { USE_CASES } from "../config/useCases";
import { DEMO_TRACE } from "../demo/trace";
import {
  COMMIT_DURATION_PRESETS,
  CONTRACT_ID,
  DEFAULT_COMMIT_DURATION_SECONDS,
  DEFAULT_ROUND_ID,
  formatDemoAmount,
  toDemoEscrowAmount,
} from "../lib/chain";
import { formatCountdown, useDrandCountdown } from "../hooks/useDrandCountdown";
import { useRoundSession, type ActionStatus } from "../hooks/useRoundSession";
import { shortAddr } from "../lib/format";
import { LOGO_SRC } from "../lib/chain";
import { ConfettiBurst } from "../ui/Confetti";
import { CountUp } from "../ui/CountUp";

type DemoMode = "live" | "evidence";

function FlowSteps({
  address,
  roundId,
  committed,
  revealed,
  working,
}: {
  address: string | null;
  roundId: bigint | null;
  committed: boolean;
  revealed: boolean;
  working: boolean;
}) {
  const steps = [
    { label: "Wallet", detail: address ? shortAddr(address, 6) : "connect", done: Boolean(address) },
    { label: "Round", detail: roundId == null ? "create" : `#${roundId}`, done: roundId != null },
    { label: "Seal", detail: committed ? "on-chain" : "commit", done: committed },
    { label: "Reveal", detail: revealed ? "opened" : "after R", done: revealed },
  ];
  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <section className={`flow-steps ${working ? "working" : ""}`}>
      {steps.map((step, index) => {
        const state = step.done ? "done" : index === activeIndex ? "active" : "idle";
        return (
          <motion.div
            key={step.label}
            className={`flow-step ${state}`}
            layout
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>{step.done ? "" : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </motion.div>
        );
      })}
    </section>
  );
}

function PhaseGuide(props: {
  useCase: UseCase;
  address: string | null;
  canUseContract: boolean;
  roundId: bigint | null;
  committed: boolean;
  revealedCount: number;
  commitSecondsRemaining: number | null;
  commitClosed: boolean;
  drandGate: ReturnType<typeof useDrandCountdown>;
  status: ActionStatus;
  entryValue: number;
  onEntryChange: (v: number) => void;
  connect: () => void;
  createRound: (durationSeconds: number) => void;
  joinRound: (id: string) => void;
  commitEntry: () => void;
  openAndReveal: () => void;
  suggestedRoundId: bigint | null;
}) {
  const {
    useCase,
    address,
    canUseContract,
    roundId,
    committed,
    revealedCount,
    commitSecondsRemaining,
    commitClosed,
    drandGate,
    status,
    entryValue,
    onEntryChange,
    connect,
    createRound,
    joinRound,
    commitEntry,
    openAndReveal,
    suggestedRoundId,
  } = props;
  const [joinId, setJoinId] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_COMMIT_DURATION_SECONDS);

  function formatDurationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return rem === 0 ? `${mins} min` : `${mins}m ${rem}s`;
  }

  const working = status === "working";
  const commitSeconds = commitSecondsRemaining ?? 0;
  // Use the selected duration (or a sensible fallback) so the progress bar
  // scales with whatever window the operator picked at creation time.
  const commitPercent =
    commitSecondsRemaining == null
      ? 0
      : Math.max(0, Math.min(100, (commitSeconds / Math.max(duration, 1)) * 100));

  let tone = "idle";
  let eyebrow = "Next step";
  let title = "Connect Freighter";
  let detail = "Use a funded Stellar testnet wallet to run a sealed round end-to-end.";
  let timerLabel = "Status";
  let timerValue = "ready";
  let ctaLabel = "Connect Freighter";
  let cta = connect;
  let ctaDisabled = working;
  let showInput = false;
  let showJoin = false;

  if (address && !canUseContract) {
    tone = "danger";
    eyebrow = "Setup";
    title = "Contract not configured";
    detail = "Set VITE_CONTRACT_ID in apps/web/.env.local and restart the dev server.";
    timerValue = "env";
    ctaLabel = "Missing env";
    ctaDisabled = true;
  } else if (address && roundId == null) {
    tone = "ready";
    eyebrow = "Step 1 · sealed round";
    title = "Create a round";
    detail = `Pick a commit window length, then create. Anyone with the round id can join and seal their own entry before the window closes.`;
    timerValue = `~${formatDurationLabel(duration)} window`;
    ctaLabel = `Create · ${formatDurationLabel(duration)}`;
    cta = () => createRound(duration);
    showJoin = true;
  } else if (roundId != null && !committed && !commitClosed) {
    // Danger threshold scales with the window: ~25% of remaining time, min 4s, max 12s.
    const dangerThreshold = Math.max(4, Math.min(12, Math.round(duration * 0.25)));
    tone = commitSeconds <= dangerThreshold ? "danger" : "urgent";
    eyebrow = `Step 2 · ${useCase.actorRole} commit`;
    title =
      useCase.inputKind === "ballot"
        ? "Cast your sealed ballot"
        : useCase.inputKind === "score"
          ? "Submit your sealed score"
          : useCase.id === "bounty"
            ? "Place your sealed bid"
            : "Submit your sealed allocation";
    detail =
      useCase.inputKind === "ballot"
        ? "Pick an option and seal it before the window closes. Encrypted to Drand R."
        : useCase.inputKind === "score"
          ? "Move the slider to your score and seal. Other judges cannot see it until R."
          : "Choose an amount and seal. The number is encrypted to Drand R until reveal.";
    timerLabel = "Time left";
    timerValue = formatCountdown(commitSeconds);
    ctaLabel = useCase.commitCta;
    cta = commitEntry;
    showInput = true;
  } else if (roundId != null && !committed && commitClosed) {
    tone = "danger";
    eyebrow = "Missed";
    title = "Commit window closed";
    detail = `Create a new round (pick a longer window if you need more time to coordinate).`;
    timerValue = "closed";
    ctaLabel = "New round";
    cta = () => createRound(duration);
  } else if (committed && revealedCount > 0) {
    tone = "complete";
    eyebrow = "Done · revealed";
    title = "Round revealed";
    detail = `${revealedCount} sealed entries opened on-chain. The contract cleared deterministically.`;
    timerValue = String(revealedCount);
    ctaLabel = "Round complete";
    ctaDisabled = true;
  } else if (committed && !commitClosed && !drandGate.published) {
    tone = "wait";
    eyebrow = "Sealed on-chain";
    title = "Entry locked";
    detail =
      "Your entry is sealed. After the commit window closes, Drand R publishes in about 10 seconds.";
    timerLabel = "Commit closes in";
    timerValue = formatCountdown(commitSeconds);
    ctaLabel = "Waiting for window";
    ctaDisabled = true;
  } else if (committed && commitClosed && !drandGate.published) {
    tone = "wait";
    eyebrow = "Sealed · waiting for R";
    title = "Wait for Drand R";
    detail = "Commit window closed. Reveal unlocks the moment round R publishes (~10s).";
    timerLabel = "Reveal in";
    timerValue = drandGate.loading ? "…" : formatCountdown(drandGate.secondsRemaining);
    ctaLabel = "Waiting for R";
    ctaDisabled = true;
  } else if (committed && drandGate.published) {
    tone = "ready";
    eyebrow = "Step 3 · reveal";
    title = "Open the gate";
    detail = "Drand R is live. Anyone can submit the BLS signature and reveal every entry at once.";
    timerValue = "live";
    ctaLabel = "Open + reveal";
    cta = openAndReveal;
  }

  if (working) {
    ctaDisabled = true;
    ctaLabel = "Signing…";
  }

  return (
    <section
      className={`phase-guide ${tone} ${working ? "working" : ""}`}
      style={{ "--commit-progress": `${commitPercent}%` } as CSSProperties}
      aria-live="polite"
    >
      <div className="phase-copy">
        <span>{eyebrow}</span>
        <AnimatePresence mode="wait">
          <motion.strong
            key={title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {title}
          </motion.strong>
        </AnimatePresence>
        <p>{detail}</p>

        {showInput ? (
          <motion.div
            className={`phase-input phase-input--${useCase.inputKind}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <label>{useCase.inputLabel}</label>

            {useCase.inputKind === "ballot" && useCase.options ? (
              <div className="option-grid" role="radiogroup" aria-label={useCase.inputLabel}>
                {useCase.options.map((option) => {
                  const selected = entryValue === option.value;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`option-card ${option.tone} ${selected ? "selected" : ""}`}
                      onClick={() => onEntryChange(option.value)}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.helper}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {useCase.inputKind === "score" ? (
              <div className="score-control">
                <div className="score-display">
                  <b>
                    {entryValue.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </b>
                  <span>{useCase.unit}</span>
                </div>
                <input
                  type="range"
                  min={useCase.min ?? 0}
                  max={useCase.max ?? 10}
                  step={useCase.step ?? 0.5}
                  value={entryValue}
                  onChange={(e) => onEntryChange(Number(e.target.value))}
                />
                <div className="score-marks" aria-hidden="true">
                  <span>0</span>
                  <span>5</span>
                  <span>10</span>
                </div>
              </div>
            ) : null}

            {useCase.inputKind === "amount" ? (
              <div className="amount-control">
                {useCase.presets ? (
                  <div className="preset-chips">
                    {useCase.presets.map((preset) => {
                      const selected = entryValue === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          className={`preset-chip ${selected ? "selected" : ""}`}
                          onClick={() => onEntryChange(preset)}
                        >
                          {preset.toLocaleString()}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="value-control">
                  <input
                    type="range"
                    min={useCase.min ?? 1}
                    max={useCase.max ?? 1000}
                    step={useCase.step ?? 1}
                    value={entryValue}
                    onChange={(e) => onEntryChange(Number(e.target.value || 1))}
                  />
                  <div className="amount-input">
                    <input
                      type="number"
                      min={useCase.min ?? 1}
                      max={useCase.max}
                      step={useCase.step ?? 1}
                      value={entryValue}
                      onChange={(e) => onEntryChange(Number(e.target.value || 1))}
                    />
                    {useCase.unit ? <span>{useCase.unit}</span> : null}
                  </div>
                </div>
              </div>
            ) : null}

            <small>
              Sealed escrow: {formatDemoAmount(toDemoEscrowAmount(entryValue))}
            </small>
          </motion.div>
        ) : null}

        {showJoin ? (
          <motion.div
            className="duration-picker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <label>Commit window</label>
            <div className="duration-chips" role="radiogroup" aria-label="Commit window length">
              {COMMIT_DURATION_PRESETS.map((preset) => {
                const selected = duration === preset.seconds;
                return (
                  <button
                    key={preset.seconds}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`duration-chip ${selected ? "selected" : ""}`}
                    onClick={() => setDuration(preset.seconds)}
                  >
                    <strong>{preset.label}</strong>
                    <small>{preset.helper}</small>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}

        {showJoin ? (
          <motion.div
            className="join-form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          >
            <div className="join-form-divider" aria-hidden="true">
              <span>or</span>
            </div>
            <label htmlFor="join-round-id">Join an existing round</label>
            <p className="join-form-helper">
              Have a round id from a teammate? Drop it here to commit alongside the existing
              bidders without creating a fresh round.
            </p>
            <div className="join-form-row">
              <div className="join-input">
                <span className="join-input-prefix">#</span>
                <input
                  id="join-round-id"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={suggestedRoundId != null ? String(suggestedRoundId) : "round id"}
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && joinId.trim() && !working) {
                      joinRound(joinId);
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={() => joinRound(joinId)}
                disabled={!joinId.trim() || working}
              >
                Join round
              </button>
            </div>
          </motion.div>
        ) : null}
      </div>

      <div className="phase-aside">
        <div className="phase-meter">
          <small>{timerLabel}</small>
          <AnimatePresence mode="wait">
            <motion.b
              key={timerValue}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {timerValue}
            </motion.b>
          </AnimatePresence>
          <i aria-hidden="true" />
        </div>
        <button
          type="button"
          className="phase-cta primary-action large"
          onClick={cta}
          disabled={ctaDisabled}
        >
          {working ? <span className="spinner" aria-hidden="true" /> : null}
          {ctaLabel}
        </button>
      </div>
    </section>
  );
}

function FeedbackPanel({
  status,
  latest,
  roundId,
  commitValue,
}: {
  status: ActionStatus;
  latest: string | null;
  roundId: bigint | null;
  commitValue: bigint | null;
}) {
  const headline =
    status === "working"
      ? "Sending…"
      : status === "ok"
        ? "Updated"
        : status === "error"
          ? "Check wallet / retry"
          : "Ready";

  const escrowLabel = commitValue == null ? "—" : formatDemoAmount(commitValue);

  return (
    <motion.section
      className={`feedback-panel ${status}`}
      layout
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <span>Status</span>
      <AnimatePresence mode="wait">
        <motion.strong
          key={headline}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {headline}
        </motion.strong>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.p
          key={latest ?? "ready"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {latest ?? "Each transaction shows up here with full context — wallet, round, seal, reveal."}
        </motion.p>
      </AnimatePresence>
      <div className="receipt-grid">
        <div>
          <small>round</small>
          <b>{roundId == null ? "—" : `#${roundId}`}</b>
        </div>
        <div>
          <small>sealed escrow</small>
          <b>{escrowLabel}</b>
        </div>
      </div>
    </motion.section>
  );
}

function LivePanel({
  active,
  session,
  onCelebrate,
}: {
  active: UseCase;
  session: ReturnType<typeof useRoundSession>;
  onCelebrate: () => void;
}) {
  const {
    address,
    walletStatus,
    entryValue,
    setEntryValue,
    status,
    canUseContract,
    targetRound,
    drandGate,
    commitSecondsRemaining,
    commitClosed,
    revealedCount,
    committed,
    commitValue,
    roundId,
    roundCreatedAt,
    live,
    log,
    revealProgress,
    connect,
    createRound,
    joinRound,
    commitEntry,
    openAndReveal,
    refresh,
  } = session;

  // Celebrate when revealedCount transitions to >0 for the first time
  const lastRevealedRef = useRef(0);
  useEffect(() => {
    if (revealedCount > 0 && lastRevealedRef.current === 0) {
      onCelebrate();
    }
    lastRevealedRef.current = revealedCount;
  }, [revealedCount, onCelebrate]);

  /**
   * Real on-chain peers participating in this round, derived from the
   * contract's bidder list. Excludes the user's own address; if there is at
   * least one other bidder we'll show real peers instead of simulated ones.
   */
  const realPeers = useMemo(() => {
    if (!live || !address) return [];
    return live.bidders
      .filter((bidder) => bidder !== address)
      .map((bidder) => {
        const state = live.bidStates[bidder];
        const revealedRaw =
          state?.revealed_value != null ? Number(state.revealed_value) : null;
        const value = revealedRaw != null ? revealedRaw / 100_000 : null;
        return {
          address: bidder,
          sealed: Boolean(state),
          revealed: state?.revealed_value != null,
          value,
        };
      });
  }, [live, address]);

  return (
    <>
      <section className="case-hero">
        <div>
          <p className="eyebrow">Live round</p>
          <h1>{active.title}</h1>
          <p className="lede">{active.oneLine}</p>
        </div>
        <div className="round-box">
          <span>round</span>
          <strong>{roundId == null ? "—" : `#${roundId}`}</strong>
          <small>{CONTRACT_ID ? shortAddr(CONTRACT_ID, 6) : "set VITE_CONTRACT_ID"}</small>
        </div>
      </section>

      <section className={`wallet-bar ${address ? "connected" : ""}`}>
        <div>
          <span>Wallet</span>
          <strong>{address ? shortAddr(address, 6) : "Not connected"}</strong>
          <p>{walletStatus}</p>
        </div>
        <button type="button" className="primary-action" onClick={() => void connect()}>
          {address ? "Reconnect" : "Connect Freighter"}
        </button>
      </section>

      <FlowSteps
        address={address}
        roundId={roundId}
        committed={committed}
        revealed={revealedCount > 0}
        working={status === "working"}
      />

      <PhaseGuide
        useCase={active}
        address={address}
        canUseContract={canUseContract}
        roundId={roundId}
        committed={committed}
        revealedCount={revealedCount}
        commitSecondsRemaining={commitSecondsRemaining}
        commitClosed={commitClosed}
        drandGate={drandGate}
        status={status}
        entryValue={entryValue}
        onEntryChange={setEntryValue}
        connect={() => void connect()}
        createRound={(duration) => void createRound(duration)}
        joinRound={(id) => void joinRound(id)}
        suggestedRoundId={DEFAULT_ROUND_ID}
        commitEntry={() => void commitEntry()}
        openAndReveal={() => void openAndReveal()}
      />

      {revealProgress ? (
        <motion.p
          className="reveal-hint"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          Revealing {revealProgress.current} / {revealProgress.total}…
        </motion.p>
      ) : null}

      <div className="proof-layout">
        {roundId == null ? (
          <ComparisonMini useCase={active} committed={committed} />
        ) : (
          <CohortPanel
            useCase={active}
            roundCreatedAt={roundCreatedAt}
            revealed={revealedCount > 0}
            userCommitted={committed}
            userValue={commitValue == null ? null : entryValue}
            realPeers={realPeers}
            roundId={roundId}
          />
        )}
        <FeedbackPanel
          status={status}
          latest={log[0] ?? null}
          roundId={roundId}
          commitValue={commitValue}
        />
      </div>

      {revealedCount > 0 ? (
        (() => {
          const useReal = realPeers.length > 0;
          const peers = useReal
            ? realPeers
                .filter((p) => p.revealed && p.value != null)
                .map((p) => ({ name: shortAddr(p.address, 5), value: p.value as number }))
            : active.cohort.map((p) => ({ name: p.name, value: p.value }));
          return (
            <OutcomePanel
              useCase={active}
              userValue={entryValue}
              peers={peers}
              isReal={useReal}
            />
          );
        })()
      ) : null}

      <section className="live-state">
        <div>
          <span>Status</span>
          <strong>{live?.round.status.tag ?? "—"}</strong>
        </div>
        <div>
          <span>Round R</span>
          <strong>
            <CountUp value={targetRound} />
          </strong>
        </div>
        <div>
          <span>Revealed</span>
          <strong>
            <CountUp value={revealedCount} />
          </strong>
        </div>
        <div>
          <button
            type="button"
            className="ghost-action"
            onClick={() => void refresh()}
            disabled={!roundId}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className={`tx-log ${status}`}>
        <span>Activity log</span>
        <AnimatePresence initial={false}>
          {log.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Connect → create round → seal → wait for Drand → reveal.
            </motion.p>
          ) : (
            log.map((line, i) => (
              <motion.p
                key={`${line}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {line}
              </motion.p>
            ))
          )}
        </AnimatePresence>
      </section>
    </>
  );
}

function ComparisonMini({ useCase, committed }: { useCase: UseCase; committed: boolean }) {
  const { comparison, examples } = useCase;
  return (
    <div className="comparison-grid">
      <article className="comparison-card leaky">
        <span>Without sealing</span>
        <h3>{comparison.leakyTitle}</h3>
        <p>{comparison.leakyBody}</p>
        <ul className="example-list" aria-label="Visible to everyone">
          {examples.map((ex) => (
            <li key={ex.name}>
              <span>{ex.name}</span>
              <b>{ex.label}</b>
            </li>
          ))}
        </ul>
      </article>
      <article className="comparison-card sealed">
        <span>Sub Rosa</span>
        <h3>{committed ? comparison.sealedTitleAfterCommit : comparison.sealedTitle}</h3>
        <p>{comparison.sealedBody}</p>
        <ul className="example-list sealed" aria-label="Sealed until reveal">
          {examples.map((ex) => (
            <li key={ex.name}>
              <span>{ex.name}</span>
              <b>•••••</b>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

function EvidencePanel() {
  return (
    <div className="evidence-stack">
      <p className="evidence-intro">
        Recorded testnet proof from <code>pnpm agents:e2e</code>. Scroll for lifecycle, attack
        demo, agents, and auditor tools.
      </p>
      <MainnetProofCard />
      <LifecycleView trace={DEMO_TRACE} />
      <AttackDemo />
      <SettlementRail trace={DEMO_TRACE} />
      <AgentActivity trace={DEMO_TRACE} />
      <X402Logs trace={DEMO_TRACE} />
      <KeeperPanel trace={DEMO_TRACE} />
      <ObserverView trace={DEMO_TRACE} live={null} />
      <AuditorView trace={DEMO_TRACE} />
      <MandateCapLab />
    </div>
  );
}

export function DemoPage({
  active,
  setActive,
  goHome,
}: {
  active: UseCase;
  setActive: (id: UseCaseId) => void;
  goHome: () => void;
}) {
  const [mode, setMode] = useState<DemoMode>("live");
  const [confettiTick, setConfettiTick] = useState(0);
  const session = useRoundSession(active);
  const sidebarDrand =
    mode === "evidence"
      ? { mode: "proof" as const, targetRound: DEMO_TRACE.meta.revealRound }
      : session.roundId != null
        ? { mode: "live-round" as const, targetRound: session.targetRound }
        : { mode: "idle" as const, targetRound: null };

  return (
    <main className="app-page">
      <ConfettiBurst fire={confettiTick} />
      <section className="app-shell">
        <aside className="case-nav">
          <button type="button" className="brand-link" onClick={goHome}>
            <img src={LOGO_SRC} alt="" />
            <span>Sub Rosa</span>
          </button>

          <div className="mode-switch" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "live"}
              className={mode === "live" ? "active" : ""}
              onClick={() => setMode("live")}
            >
              {mode === "live" ? <motion.span layoutId="mode-pill" className="mode-pill" /> : null}
              Live round
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "evidence"}
              className={mode === "evidence" ? "active" : ""}
              onClick={() => setMode("evidence")}
            >
              {mode === "evidence" ? (
                <motion.span layoutId="mode-pill" className="mode-pill" />
              ) : null}
              Evidence
            </button>
          </div>

          {mode === "live" ? (
            <>
              <div className="case-nav-section-label">Cases</div>
              {USE_CASES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`case-link ${active.id === item.id ? "active" : ""}`}
                  onClick={() => setActive(item.id)}
                >
                  <span aria-hidden="true" />
                  {item.nav}
                </button>
              ))}
            </>
          ) : null}

          <DrandCountdownChip mode={sidebarDrand.mode} targetRound={sidebarDrand.targetRound} />
        </aside>

        <AnimatePresence mode="wait">
          <motion.section
            key={`${mode}-${active.id}`}
            className="case-workspace"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            {mode === "live" ? (
              <LivePanel
                active={active}
                session={session}
                onCelebrate={() => setConfettiTick((t) => t + 1)}
              />
            ) : (
              <EvidencePanel />
            )}
          </motion.section>
        </AnimatePresence>
      </section>
    </main>
  );
}
