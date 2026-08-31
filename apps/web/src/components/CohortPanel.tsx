// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Peer, UseCase } from "../config/useCases";
import { shortAddr } from "../lib/format";
import { useTime } from "../lib/time";

type PeerState = "pending" | "sealing" | "sealed" | "revealed";

function peerStateAt(
  peer: Peer,
  roundCreatedAt: number | null,
  now: number,
  revealed: boolean,
): PeerState {
  if (revealed) return "revealed";
  if (roundCreatedAt == null) return "pending";
  const elapsed = now - roundCreatedAt;
  if (elapsed < peer.delayMs - 600) return "pending";
  if (elapsed < peer.delayMs) return "sealing";
  return "sealed";
}

export interface RealPeer {
  address: string;
  sealed: boolean;
  revealed: boolean;
  /** raw decoded value in the active case's display units */
  value: number | null;
}

interface CohortPanelProps {
  useCase: UseCase;
  roundCreatedAt: number | null;
  revealed: boolean;
  /** user's own committed flag */
  userCommitted: boolean;
  userValue: number | null;
  /** on-chain peers (others in this round) — when present we render real flow */
  realPeers: RealPeer[];
  roundId: bigint | null;
}

function pasteRoundId(roundId: bigint | null): string {
  return roundId == null ? "" : `#${roundId}`;
}

function CohortValueRevealed({ label }: { label: string }) {
  return (
    <motion.span
      key="revealed"
      className="cohort-value revealed"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {label}
    </motion.span>
  );
}

function CohortValueSealed() {
  return (
    <motion.span
      key="sealed"
      className="cohort-value sealed"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      ●●●●●●
    </motion.span>
  );
}

function CohortValueSealing() {
  return (
    <motion.span
      key="sealing"
      className="cohort-value sealing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      sealing…
    </motion.span>
  );
}

function CohortValuePending({ text = "idle" }: { text?: string }) {
  return (
    <motion.span
      key="pending"
      className="cohort-value pending"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {text}
    </motion.span>
  );
}

export function CohortPanel({
  useCase,
  roundCreatedAt,
  revealed,
  userCommitted,
  userValue,
  realPeers,
  roundId,
}: CohortPanelProps) {
  const { clock, scheduler } = useTime();
  const [now, setNow] = useState(() => clock.nowMs());
  const useReal = realPeers.length > 0;

  useEffect(() => {
    if (useReal || roundCreatedAt == null || revealed) return;
    const handle = scheduler.setInterval(() => setNow(clock.nowMs()), 250);
    return () => scheduler.clear(handle);
  }, [useReal, roundCreatedAt, revealed, clock, scheduler]);

  const simulatedPeers = useCase.cohort;
  const simulatedSealed = simulatedPeers.filter(
    (peer) => peerStateAt(peer, roundCreatedAt, now, revealed) !== "pending",
  ).length;

  const totalCount = useReal ? realPeers.length + 1 : simulatedPeers.length + 1;
  const sealedTotal = useReal
    ? realPeers.filter((p) => p.sealed).length + (userCommitted ? 1 : 0)
    : simulatedSealed + (userCommitted ? 1 : 0);

  const headerLabel = useReal ? "On-chain cohort" : "Sealed cohort";
  const headerDescription = useReal
    ? `Live on-chain participants for round ${pasteRoundId(roundId)}. Every row is a real Stellar address committing to the same Drand R.`
    : "Each row is encrypted to Drand R until reveal. Other participants are simulated for the demo; your commit is real on-chain.";

  return (
    <section className="cohort-panel">
      <header className="cohort-head">
        <div>
          <span className="cohort-eyebrow">{headerLabel}</span>
          <h3>Round participants</h3>
          <p>{headerDescription}</p>
        </div>
        <div className="cohort-counter">
          <span>Sealed</span>
          <strong>
            {sealedTotal} / {totalCount}
          </strong>
        </div>
      </header>

      <ul className="cohort-list">
        <li
          className={`cohort-row you ${userCommitted ? "sealed" : "pending"} ${revealed ? "revealed" : ""}`}
        >
          <div className="cohort-name">
            <span className="cohort-dot" aria-hidden="true" />
            <strong>You</strong>
            <small>live · on-chain</small>
          </div>
          <div className="cohort-state">
            <AnimatePresence mode="wait" initial={false}>
              {revealed && userValue != null ? (
                <CohortValueRevealed label={useCase.formatValue(userValue)} />
              ) : userCommitted ? (
                <CohortValueSealed />
              ) : (
                <CohortValuePending text="awaiting commit…" />
              )}
            </AnimatePresence>
          </div>
        </li>

        {useReal
          ? realPeers.map((peer) => {
              const state: PeerState = peer.revealed
                ? "revealed"
                : peer.sealed
                  ? "sealed"
                  : "pending";
              return (
                <li key={peer.address} className={`cohort-row ${state}`}>
                  <div className="cohort-name">
                    <span className="cohort-dot" aria-hidden="true" />
                    <strong>{shortAddr(peer.address, 5)}</strong>
                    <small>on-chain participant</small>
                  </div>
                  <div className="cohort-state">
                    <AnimatePresence mode="wait" initial={false}>
                      {state === "revealed" && peer.value != null ? (
                        <CohortValueRevealed label={useCase.formatValue(peer.value)} />
                      ) : state === "sealed" ? (
                        <CohortValueSealed />
                      ) : (
                        <CohortValuePending text="not yet committed" />
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })
          : simulatedPeers.map((peer) => {
              const state = peerStateAt(peer, roundCreatedAt, now, revealed);
              return (
                <li key={peer.name} className={`cohort-row ${state}`}>
                  <div className="cohort-name">
                    <span className="cohort-dot" aria-hidden="true" />
                    <strong>{peer.name}</strong>
                    <small>demo cohort</small>
                  </div>
                  <div className="cohort-state">
                    <AnimatePresence mode="wait" initial={false}>
                      {state === "revealed" ? (
                        <CohortValueRevealed label={useCase.formatValue(peer.value)} />
                      ) : state === "sealed" ? (
                        <CohortValueSealed />
                      ) : state === "sealing" ? (
                        <CohortValueSealing />
                      ) : (
                        <CohortValuePending />
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
      </ul>
    </section>
  );
}
