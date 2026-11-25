// Copyright (c) 2026 Sub Rosa contributors
import { MAINNET_ARTIFACTS } from "@sub-rosa/sdk";
import { shortAddr } from "../lib/format";

export function MainnetProofCard() {
  const a = MAINNET_ARTIFACTS;

  return (
    <section className="panel mainnet-proof-panel">
      <header className="panel-head">
        <h2>Mainnet settlement proof</h2>
        <p>
          Primitive smoke on Stellar mainnet — native XLM SAC, not testnet USDC demo amounts.
          Full multi-agent product proof lives on testnet.
        </p>
      </header>

      <div className="mainnet-proof-grid">
        <article className="card accent-card">
          <h3>Deployed Round</h3>
          <dl className="kv">
            <dt>Network</dt>
            <dd>{a.network}</dd>
            <dt>Contract</dt>
            <dd>
              <code className="tiny">{shortAddr(a.contractId, 14)}</code>
            </dd>
            <dt>WASM hash</dt>
            <dd>
              <code className="tiny">{a.wasmHash.slice(0, 16)}…</code>
            </dd>
            <dt>Round</dt>
            <dd>
              #{a.settledRoundId} · <strong>{a.status}</strong>
            </dd>
            <dt>Drand R</dt>
            <dd>{a.revealRound.toLocaleString()}</dd>
            <dt>Escrow token</dt>
            <dd>{a.escrowToken}</dd>
            <dt>Bid / escrow</dt>
            <dd>
              {a.bidXlm} / {a.escrowXlm} XLM
            </dd>
          </dl>
        </article>

        <article className="card">
          <h3>Verify locally</h3>
          <ul className="keeper-list">
            <li>
              <strong>Read-only</strong>
              <span>
                <code>{a.proofCommand}</code>
              </span>
            </li>
            <li>
              <strong>Dry-run checklist</strong>
              <span>
                <code>pnpm mainnet:micro</code>
              </span>
            </li>
            <li>
              <strong>Explorer</strong>
              <span>
                <a href={a.explorerContract} target="_blank" rel="noreferrer">
                  stellar.expert contract
                </a>
              </span>
            </li>
          </ul>
          <p className="muted">
            Keeper opened at R with on-chain BLS verify, revealed, cleared, and settled.
            Contract balance drained after <code>settle()</code>.
          </p>
        </article>
      </div>
    </section>
  );
}
