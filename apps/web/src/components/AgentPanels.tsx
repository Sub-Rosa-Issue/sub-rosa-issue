// Copyright (c) 2026 Sub Rosa contributors
import type { DemoTrace } from "../demo/trace";
import { shortAddr, shortHash, usdc } from "../lib/format";

export function AgentActivity({ trace }: { trace: DemoTrace }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Agent activity</h2>
        <p>
          Principals delegate session keys via signed mandates. Agents pay x402, size bids,
          and commit — never using the principal key on-chain.
        </p>
      </header>
      <div className="agent-cards">
        {trace.agents.map((a) => (
          <article key={a.name} className="agent-card">
            <h3>{a.name}</h3>
            <dl className="kv">
              <dt>Principal</dt>
              <dd><code>{shortAddr(a.principal, 8)}</code></dd>
              <dt>Session key (signer)</dt>
              <dd><code>{shortAddr(a.sessionKey, 8)}</code></dd>
              <dt>Mandate max bid</dt>
              <dd>{usdc(a.mandate.maxBidUsdc)} USDC</dd>
              <dt>Appraisal fair value</dt>
              <dd>{usdc(a.appraisal.fairValue)}</dd>
              <dt>Suggested max bid</dt>
              <dd>{usdc(a.appraisal.suggestedMaxBid)}</dd>
              <dt>Committed bid</dt>
              <dd className="accent">
                {usdc(
                  trace.bidders.find((b) => b.label === a.name)?.bidUsdc ?? 0,
                )}{" "}
                USDC
                {a.mandate.cappedAtMaxBid && (
                  <span className="tag warn">capped at mandate maxBid</span>
                )}
              </dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function X402Logs({ trace }: { trace: DemoTrace }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>x402 appraisal log</h2>
        <p>Agent-to-service payment: HTTP 402 → signed USDC auth entry → on-chain settle → appraisal.</p>
      </header>
      <div className="table-wrap">
        <table className="table table-x402">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Price</th>
              <th>Settled</th>
              <th>Appraisal inputs</th>
            </tr>
          </thead>
          <tbody>
            {trace.agents.map((a) => (
              <tr key={a.name}>
                <td>{a.name}</td>
                <td className="nowrap">{usdc(a.x402.priceUsdc)} USDC</td>
                <td className="nowrap">{a.x402.settled ? "✓ on-chain" : "—"}</td>
                <td className="col-hash">
                  <code className="tiny" title={a.appraisal.inputsHash}>
                    {shortHash(a.appraisal.inputsHash)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function KeeperPanel({ trace }: { trace: DemoTrace }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Keeper · reveal · clear · settle</h2>
        <p>Permissionless third party — no operator privilege.</p>
      </header>
      <ul className="keeper-list">
        <li>
          <strong>Wait Drand R={trace.keeper.drandRound.toLocaleString()}</strong>
          <span>Real quicknet beacon</span>
        </li>
        <li>
          <strong>open_reveal</strong>
          <span>
            BLS12-381 verified on-chain
            {trace.keeper.blsVerifiedOnChain ? " ✓" : ""}
          </span>
        </li>
        {trace.keeper.reveals.map((r) => (
          <li key={r}>
            <strong>reveal</strong>
            <span>{r}</span>
          </li>
        ))}
        <li>
          <strong>clear</strong>
          <span>Winner {shortAddr(trace.keeper.clearWinner ?? "", 10)}</span>
        </li>
        <li>
          <strong>settle</strong>
          <span>{trace.settlement.note}</span>
        </li>
      </ul>
    </section>
  );
}
