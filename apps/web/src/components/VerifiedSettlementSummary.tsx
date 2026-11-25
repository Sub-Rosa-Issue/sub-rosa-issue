// Copyright (c) 2026 Sub Rosa contributors
import { formatEscrowAmount } from "../lib/amount";
import { shortAddr } from "../lib/format";
import type { VerifiedSettlement } from "../lib/verified-settlement";

/** Renders the verified winner and refund set; nothing monetary before verification. */
export function VerifiedSettlementSummary({ settlement }: { settlement: VerifiedSettlement }) {
  if (settlement.state === "pending") {
    return (
      <div className="verified-settlement" data-settlement-state="pending">
        <span className="muted">Verifying settlement receipt…</span>
      </div>
    );
  }
  if (settlement.state === "rejected") {
    return (
      <div className="verified-settlement" data-settlement-state="rejected">
        <span className="tag warn">Receipt rejected</span> <code>{settlement.code}</code>
      </div>
    );
  }
  return (
    <div className="verified-settlement" data-settlement-state="verified">
      <p data-settlement-winner={settlement.winner?.address ?? ""}>
        {settlement.winner ? (
          <>
            Verified winner <code>{shortAddr(settlement.winner.address, 8)}</code> ·{" "}
            <strong>{formatEscrowAmount(settlement.winner.value, "USDC")}</strong>
          </>
        ) : (
          "Verified: no winner"
        )}
      </p>
      <ul className="refund-list">
        {settlement.refunds.map((refund) => (
          <li key={refund.address} data-refund={refund.address}>
            Refund <code>{shortAddr(refund.address, 8)}</code> ·{" "}
            {formatEscrowAmount(refund.amount, "USDC")}
          </li>
        ))}
      </ul>
    </div>
  );
}
