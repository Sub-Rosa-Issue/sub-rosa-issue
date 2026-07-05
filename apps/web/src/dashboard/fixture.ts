// Bundled fixture for the monitoring dashboard.
// Used when VITE_DASHBOARD_ENDPOINT is not configured.

import type { DashboardData } from "./types";

export const DASHBOARD_FIXTURE: DashboardData = {
  meta: {
    contractId: "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y",
    roundId: 1,
    network: "Stellar Testnet",
    clearingRule: "HighestBid",
    fetchedAt: "2026-06-01T17:14:46.200Z",
  },
  round: {
    status: "Settled",
    commitDeadline: 1748797200, // 2025-06-01T15:00:00Z
    revealDeadline: 1748800800, // 2025-06-01T16:00:00Z
    revealRound: 29176840,
    winner: "GAKZTF6HNE2CKUDFQUO5F2XNGWXSG3QI3NO7DXFMRAVIQKEO6NIJT7NQ",
    winningBid: 700,
  },
  keeper: {
    currentPhase: "complete",
    nextAction: "none — round settled",
    lastActionAt: "2026-06-01T17:14:46.200Z",
    actionHistory: [
      {
        timestamp: "2026-06-01T17:14:46.200Z",
        action: "settle",
        txHash: "a1b2c3d4e5f6789012345678901234567890abcd",
        success: true,
      },
      {
        timestamp: "2026-06-01T17:10:22.000Z",
        action: "clear",
        txHash: "b2c3d4e5f6789012345678901234567890abcde1",
        success: true,
      },
      {
        timestamp: "2026-06-01T17:05:18.000Z",
        action: "reveal agent-beta → 459.34 USDC",
        txHash: "c3d4e5f6789012345678901234567890abcde12f",
        success: true,
      },
      {
        timestamp: "2026-06-01T17:05:12.000Z",
        action: "reveal agent-alpha → 700 USDC",
        txHash: "d4e5f6789012345678901234567890abcde123f4",
        success: true,
      },
      {
        timestamp: "2026-06-01T17:00:05.000Z",
        action: "open reveal (Drand R=29176840 BLS verified)",
        txHash: "e5f6789012345678901234567890abcde1234f5a",
        success: true,
      },
    ],
  },
  bidders: [
    {
      address: "GAKZTF6HNE2CKUDFQUO5F2XNGWXSG3QI3NO7DXFMRAVIQKEO6NIJT7NQ",
      label: "agent-alpha",
      committed: true,
      revealed: true,
      valid: true,
      settled: true,
      escrowUsdc: 700,
      bidUsdc: 700,
    },
    {
      address: "GCO5ETWJKVYYVGUCTTRCXDWNQAZNIZ3F4LWZI5VRF6CBTKUSBSQ7CUQR",
      label: "agent-beta",
      committed: true,
      revealed: true,
      valid: true,
      settled: true,
      escrowUsdc: 459.34,
      bidUsdc: 459.34,
    },
  ],
  settlement: {
    operatorReceivedUsdc: 700,
    refundsUsdc: 459.34,
    contractBalance: 0,
    note: "Winner pays bid from escrow; loser refunded in full. Contract holds 0 USDC after settle.",
  },
};
