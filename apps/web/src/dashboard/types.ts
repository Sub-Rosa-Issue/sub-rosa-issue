// Types for the monitoring dashboard data structure.

export type RoundStatus = "Open" | "Revealing" | "Cleared" | "Settled" | "Voided";

export type KeeperDryRunPhase =
  | "awaiting-drand"
  | "stale-open"
  | "revealing"
  | "awaiting-clear"
  | "ready-to-clear"
  | "ready-to-settle"
  | "complete";

export interface KeeperAction {
  timestamp: string;
  action: string;
  txHash?: string;
  success: boolean;
}

export interface BidderProgress {
  address: string;
  label?: string;
  committed: boolean;
  revealed: boolean;
  valid: boolean | null;
  settled: boolean;
  escrowUsdc: number;
  bidUsdc: number | null;
}

export interface DashboardData {
  meta: {
    contractId: string;
    roundId: number;
    network: string;
    clearingRule: "HighestBid" | "LowestBid";
    fetchedAt: string; // ISO timestamp
  };
  round: {
    status: RoundStatus;
    commitDeadline: number; // unix seconds
    revealDeadline: number; // unix seconds
    revealRound: number; // Drand round R
    winner: string | null;
    winningBid: number | null;
  };
  keeper: {
    currentPhase: KeeperDryRunPhase;
    nextAction: string;
    lastActionAt: string | null;
    actionHistory: KeeperAction[];
  };
  bidders: BidderProgress[];
  settlement: {
    operatorReceivedUsdc: number;
    refundsUsdc: number;
    contractBalance: number;
    note: string;
  } | null;
}
