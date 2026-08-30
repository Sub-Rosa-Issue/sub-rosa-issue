// Copyright (c) 2026 Sub Rosa contributors
import type { DemoTrace } from "../demo/trace";
import { usdc } from "../lib/format";

export function SettlementRail({ trace }: { trace: DemoTrace }) {
  return (
    <section className="panel settlement-panel">
      <header className="panel-head">
        <h2>Settlement rails — x402 vs SAC</h2>
        <p>Two SEP-41 USDC paths, different jobs. Winner prize settlement is not x402.</p>
      </header>

      <div className="settlement-grid">
        <article className="card">
          <h3>x402 (appraisal micro-payment)</h3>
          <ul className="keeper-list">
            <li>
              <strong>Who pays</strong>
              <span>Agent session key → appraisal server</span>
            </li>
            <li>
              <strong>Amount</strong>
              <span>{usdc(trace.agents[0]?.x402.priceUsdc ?? 0.1)} USDC per call</span>
            </li>
            <li>
              <strong>Mechanism</strong>
              <span>HTTP 402 → signed auth entry → facilitator settles on Soroban RPC</span>
            </li>
            <li>
              <strong>Proven</strong>
              <span>pnpm appraisal:e2e, agents:e2e</span>
            </li>
          </ul>
        </article>

        <article className="card accent-card">
          <h3>SAC settle() (winner prize)</h3>
          <ul className="keeper-list">
            <li>
              <strong>Who pays</strong>
              <span>Winner escrow → operator; losers refunded</span>
            </li>
            <li>
              <strong>Amount</strong>
              <span>{usdc(trace.settlement.operatorReceivedUsdc)} USDC to operator</span>
            </li>
            <li>
              <strong>Mechanism</strong>
              <span>Round contract <code>settle()</code> — native SAC transfer, not HTTP 402</span>
            </li>
            <li>
              <strong>Same asset rail</strong>
              <span>USDC Stellar Asset Contract (SEP-41) as x402; different authorization path</span>
            </li>
          </ul>
        </article>
      </div>

      <p className="muted">
        {trace.settlement.note} Appraisal spend is gated by mandate{" "}
        <code>maxAppraisalSpend</code> off-chain; prize movement is enforced by the contract at
        settle.
      </p>
    </section>
  );
}
