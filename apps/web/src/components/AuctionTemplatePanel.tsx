import { useMemo, useState } from "react";
import type { UseCase } from "../config/useCases";
import { formatDemoAmount } from "../lib/chain";
import { usdc } from "../lib/format";
import type { ActionStatus } from "../hooks/useRoundSession";

type AuctionViewMode = "fixture" | "testnet";

type AuctionTemplatePanelProps = {
  active: UseCase;
  address: string | null;
  roundId: bigint | null;
  commitValue: bigint | null;
  committed: boolean;
  revealedCount: number;
  canUseContract: boolean;
  commitClosed: boolean;
  status: ActionStatus;
  live: {
    round: { status: { tag: string } };
    bidders: string[];
    bidStates: Record<string, { escrow?: bigint; revealed_value?: bigint | null }>;
  } | null;
};

type Summary = {
  modeLabel: string;
  escrow: string;
  status: string;
  winner: string;
  operatorPayout: string;
  refunds: string;
  note: string;
};

function stableFingerprint(parts: Array<string | number | bigint | null | undefined>) {
  let hash = 0xcbf29ce484222325n;
  const source = parts
    .map((part) => (part == null ? "null" : String(part)))
    .join("::")
    .toLowerCase();

  for (const char of source) {
    hash ^= BigInt(char.charCodeAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}

export function AuctionTemplatePanel({
  active,
  address,
  roundId,
  commitValue,
  committed,
  revealedCount,
  canUseContract,
  commitClosed,
  live,
  status,
}: AuctionTemplatePanelProps) {
  const [viewMode, setViewMode] = useState<AuctionViewMode>("fixture");

  const fixtureSummary = useMemo<Summary>(() => {
    const escrow = formatDemoAmount(820_000_0n);
    const winners = "Bidder B";
    return {
      modeLabel: "Fixture preview",
      escrow,
      status: "settled",
      winner: winners,
      operatorPayout: usdc(620),
      refunds: usdc(410),
      note: "The fixture models a highest-bid auction with a valid escrow and a single refund path.",
    };
  }, []);

  const liveSummary = useMemo<Summary | null>(() => {
    if (!live) {
      return null;
    }

    const bidders = live.bidders ?? [];
    const scores = bidders
      .map((bidder) => ({
        bidder,
        escrow: live.bidStates[bidder]?.escrow ?? 0n,
        revealedValue: live.bidStates[bidder]?.revealed_value ?? null,
      }))
      .filter((item) => item.revealedValue != null);

    const winner = scores.reduce<{ bidder: string; revealedValue: bigint } | null>(
      (best, item) => {
        if (best == null || (item.revealedValue != null && item.revealedValue > best.revealedValue)) {
          return { bidder: item.bidder, revealedValue: item.revealedValue };
        }
        return best;
      },
      null,
    );

    const escrow = commitValue == null ? formatDemoAmount(0n) : formatDemoAmount(commitValue);
    return {
      modeLabel: address ? "Testnet round" : "Fixture preview",
      escrow,
      status: live.round.status.tag,
      winner: winner?.bidder ? shortAddr(winner.bidder, 6) : "pending",
      operatorPayout: winner ? usdc(Number(winner.revealedValue) / 100_000) : usdc(0),
      refunds: `${bidders.length - (winner ? 1 : 0)} refund${bidders.length - (winner ? 1 : 0) === 1 ? "" : "s"}`,
      note: revealedCount > 0
        ? "The round has revealed values and settled the winner deterministically."
        : "The live round is waiting for reveal or settlement.",
    };
  }, [address, commitValue, live, revealedCount]);

  const activeSummary = viewMode === "fixture" ? fixtureSummary : liveSummary ?? fixtureSummary;
  const receiptFingerprint = useMemo(
    () =>
      stableFingerprint([
        active.id,
        viewMode,
        roundId?.toString() ?? "fixture",
        activeSummary.escrow,
        activeSummary.winner,
        activeSummary.operatorPayout,
        activeSummary.refunds,
      ]),
    [active.id, activeSummary.escrow, activeSummary.operatorPayout, activeSummary.refunds, activeSummary.winner, roundId, viewMode],
  );

  return (
    <section className="auction-template-panel">
      <header className="auction-template-header">
        <div>
          <p className="eyebrow">Auction template</p>
          <h2>Sealed auction flow with escrow, reveal, payout, and refund rails</h2>
          <p>
            This template mirrors the same SDK and tlock path as the live round flow, but it adds
            auction-specific UI for registration, validation, settlement, and failure handling.
          </p>
        </div>
        <div className="auction-template-toggle" role="tablist" aria-label="Auction template mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "fixture"}
            className={viewMode === "fixture" ? "active" : ""}
            onClick={() => setViewMode("fixture")}
          >
            Fixture review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "testnet"}
            className={viewMode === "testnet" ? "active" : ""}
            onClick={() => setViewMode("testnet")}
          >
            Testnet mode
          </button>
        </div>
      </header>

      <div className="auction-template-grid">
        <article className="auction-template-card">
          <h3>Protocol layer</h3>
          <ul className="auction-template-list">
            <li>Round creation sets reveal round R, commit deadline, reveal deadline, and auditor key.</li>
            <li>Bidder commits a sealed bid plus escrow using the shared SDK and tlock helpers.</li>
            <li>Reveal opens once Drand R is published and the contract verifies the signature.</li>
            <li>Clear/settle uses the existing highest-bid clearing behavior and refunds losers.</li>
          </ul>
        </article>

        <article className="auction-template-card">
          <h3>Template-specific UI</h3>
          <ul className="auction-template-list">
            <li>Bidder registration and bid entry are presented as an auction flow rather than a generic ballot.</li>
            <li>Escrow validation and failure cases are surfaced inline for operators and bidders.</li>
            <li>Receipt styling makes the winning bid, payout, and refund state easy to verify.</li>
            <li>{viewMode === "fixture" ? "Fixture mode shows the full path without wallet access or secrets." : "Testnet mode expects Freighter plus a configured contract id."}</li>
          </ul>
        </article>
      </div>

      <div className="auction-template-grid">
        <article className="auction-template-card">
          <h3>Lifecycle</h3>
          <ol className="auction-template-steps">
            <li>Register bidder and preview the auction parameters.</li>
            <li>Seal the bid and lock escrow; the contract rejects bids where the revealed value exceeds escrow.</li>
            <li>Wait for Drand R, then open the reveal and decrypt the sealed set.</li>
            <li>Select the highest valid bid, pay the operator, and refund the remaining bidders.</li>
          </ol>
        </article>

        <article className="auction-template-card">
          <h3>Common failure cases</h3>
          <ul className="auction-template-list">
            <li><strong>Under-escrowed bid</strong> — the revealed value is above the escrow ceiling, so the contract rejects the reveal.</li>
            <li><strong>Missed reveal</strong> — the bidder never reveals and the round cannot award them a payout.</li>
            <li><strong>Late commit</strong> — commit closes before the bidder seals, so the round moves on without them.</li>
            <li><strong>Void after grace</strong> — if reveal never completes, the round can be voided after the grace window.</li>
          </ul>
        </article>
      </div>

      <article className="auction-template-card receipt-card">
        <h3>Receipt-style summary</h3>
        <div className="auction-template-receipt-grid">
          <div>
            <small>Mode</small>
            <strong>{activeSummary.modeLabel}</strong>
          </div>
          <div>
            <small>Round</small>
            <strong>{roundId == null ? "pending" : `#${roundId}`}</strong>
          </div>
          <div>
            <small>Escrow</small>
            <strong>{activeSummary.escrow}</strong>
          </div>
          <div>
            <small>Winner</small>
            <strong>{activeSummary.winner}</strong>
          </div>
          <div>
            <small>Operator payout</small>
            <strong>{activeSummary.operatorPayout}</strong>
          </div>
          <div>
            <small>Refunds</small>
            <strong>{activeSummary.refunds}</strong>
          </div>
        </div>
        <p className="auction-template-muted">
          Receipt fingerprint: <code>{receiptFingerprint}</code>
        </p>
        <p className="auction-template-muted">
          {activeSummary.note} The current state is {committed ? "sealed" : "awaiting seal"}, {commitClosed ? "commit window closed" : "commit window open"}, and {revealedCount > 0 ? "revealed" : "not yet revealed"}.
        </p>
        <p className="auction-template-muted">
          {viewMode === "testnet" && !canUseContract
            ? "Connect Freighter and configure a contract id to run the live round path."
            : viewMode === "testnet" && status === "working"
              ? "The live round is processing the next on-chain transition."
              : "Fixture mode is available locally without secrets; testnet mode uses the same on-chain execution path when configured."}
        </p>
      </article>
    </section>
  );
}

function shortAddr(addr: string, len = 6) {
  if (addr.length <= len * 2 + 3) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}
