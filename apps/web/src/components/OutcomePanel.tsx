import { motion } from "framer-motion";
import type { UseCase } from "../config/useCases";

export interface OutcomePeer {
  /** display label (e.g. "Member alpha" or shortened on-chain address) */
  name: string;
  value: number;
}

function HighestOutcome({
  useCase,
  peers,
  userValue,
}: {
  useCase: UseCase;
  peers: OutcomePeer[];
  userValue: number;
}) {
  type Row = { name: string; value: number; isYou: boolean };
  const rows: Row[] = [
    ...peers.map((p) => ({ name: p.name, value: p.value, isYou: false })),
    { name: "You", value: userValue, isYou: true },
  ].sort((a, b) => b.value - a.value);
  const winner = rows[0];
  const max = winner.value;

  return (
    <div className="outcome-highest">
      <div className="outcome-headline">
        <span>{winner.isYou ? "You won the bid" : `Winner · ${winner.name}`}</span>
        <strong>{useCase.formatValue(winner.value)}</strong>
      </div>
      <ul className="bid-list">
        {rows.map((row, i) => {
          const pct = max === 0 ? 0 : (row.value / max) * 100;
          return (
            <li
              key={`${row.name}-${i}`}
              className={`bid-row ${row.isYou ? "you" : ""} ${i === 0 ? "top" : ""}`}
            >
              <div className="bid-label">
                <strong>{row.name}</strong>
                <b>{useCase.formatValue(row.value)}</b>
              </div>
              <div className="bid-track">
                <motion.div
                  className="bid-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="outcome-foot">
        Highest sealed bid clears. No one saw the leading number before Drand R published the
        signature.
      </p>
    </div>
  );
}

export function OutcomePanel({
  useCase,
  userValue,
  peers,
  isReal,
}: {
  useCase: UseCase;
  /** user's revealed numeric value */
  userValue: number;
  /** participants other than the user (real on-chain or simulated cohort) */
  peers: OutcomePeer[];
  /** whether `peers` were sourced from real on-chain bidders */
  isReal: boolean;
}) {
  return (
    <motion.section
      className="outcome-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <header>
        <span className="outcome-badge">
          {isReal ? "On-chain reveal" : "Round revealed"}
        </span>
        <h2>{useCase.tagline} · final result</h2>
      </header>
      <HighestOutcome useCase={useCase} peers={peers} userValue={userValue} />
    </motion.section>
  );
}
