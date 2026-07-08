import { shortAddr, usdc } from "../../lib/format";
import type { DashboardData } from "../../dashboard/types";

export function SettlementCard({ data }: { data: DashboardData }) {
  const { round, settlement } = data;
  const isVoided = round.status === "Voided";
  const isSettled = round.status === "Settled";

  if (!isSettled && !isVoided) {
    return null;
  }

  return (
    <section className="dashboard-card settlement-card">
      <header className="dashboard-card-header">
        <h2>Settlement</h2>
        <span className={`dashboard-settlement-badge ${isVoided ? "voided" : "settled"}`}>
          {isVoided ? "Voided" : "Settled"}
        </span>
      </header>

      <div className="dashboard-card-body">
        {isVoided ? (
          <p className="dashboard-voided-message">
            Round was voided. All escrow has been refunded to bidders.
          </p>
        ) : (
          <>
            {round.winner && (
              <div className="dashboard-winner-section">
                <div className="dashboard-kv-row">
                  <span className="dashboard-kv-label">Winner</span>
                  <code className="dashboard-kv-value truncate">
                    {shortAddr(round.winner, 8)}
                  </code>
                </div>
                {round.winningBid !== null && (
                  <div className="dashboard-kv-row">
                    <span className="dashboard-kv-label">Winning Bid</span>
                    <span className="dashboard-kv-value highlight">
                      {usdc(round.winningBid)} USDC
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {settlement && (
          <div className="dashboard-settlement-stats">
            <div className="dashboard-stat">
              <span className="dashboard-stat-value">{usdc(settlement.operatorReceivedUsdc)}</span>
              <span className="dashboard-stat-label">Operator Received (USDC)</span>
            </div>
            <div className="dashboard-stat">
              <span className="dashboard-stat-value">{usdc(settlement.refundsUsdc)}</span>
              <span className="dashboard-stat-label">Refunds (USDC)</span>
            </div>
            <div className="dashboard-stat">
              <span className="dashboard-stat-value">{usdc(settlement.contractBalance)}</span>
              <span className="dashboard-stat-label">Contract Balance (USDC)</span>
            </div>
          </div>
        )}

        {settlement?.note && (
          <p className="dashboard-settlement-note">{settlement.note}</p>
        )}
      </div>
    </section>
  );
}
