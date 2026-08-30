// Copyright (c) 2026 Sub Rosa contributors
// Types for the jury demo trace. Data lives in demo-trace.generated.ts (from agents:e2e).

import { DEMO_TRACE as GENERATED } from "./demo-trace.generated";

export type LifecyclePhase =
  | "create_round"
  | "commit"
  | "wait_r"
  | "open_reveal"
  | "reveal_all"
  | "clear"
  | "settle";

export interface DemoTrace {
  meta: {
    title: string;
    network: string;
    contractId: string;
    roundId: number;
    revealRound: number;
    clearingRule: "HighestBid" | "LowestBid";
    recordedAt: string;
    roundStatus: string;
    liveE2e: string[];
    proofScope: string;
  };
  lifecycle: Array<{
    phase: LifecyclePhase;
    label: string;
    detail: string;
    status: "done" | "active" | "pending";
  }>;
  bidders: Array<{
    label: string;
    address: string;
    role: "agent" | "human";
    escrowUsdc: number;
    bidUsdc: number | null;
    revealed: boolean;
    valid: boolean;
    winner: boolean;
  }>;
  agents: Array<{
    name: string;
    principal: string;
    sessionKey: string;
    mandate: {
      maxBidUsdc: number;
      maxEscrowUsdc: number;
      maxAppraisalSpendUsdc: number;
      cappedAtMaxBid: boolean;
    };
    appraisal: {
      fairValue: number;
      suggestedMaxBid: number;
      inputsHash: string;
    };
    x402: {
      priceUsdc: number;
      settled: boolean;
      tx?: string;
    };
    commitTx?: string;
  }>;
  keeper: {
    openRevealTx?: string;
    drandRound: number;
    blsVerifiedOnChain: boolean;
    reveals: string[];
    clearWinner?: string;
    settleTx?: string;
    contractBalanceFinal: number;
  };
  settlement: {
    operatorReceivedUsdc: number;
    refundsUsdc: number;
    note: string;
  };
  auditor: {
    source: string;
    generatedAt: string;
    secretHex: string;
    publicHex: string;
    blobs: Record<string, string>;
  };
}

export const DEMO_TRACE = GENERATED as unknown as DemoTrace;

export const isTraceSettled = (trace: DemoTrace = DEMO_TRACE) =>
  trace.meta.roundStatus === "Settled";

export const CAP_SAFETY_COPY = {
  mandateTitle: "Agent mandate caps (off-chain)",
  mandateBody:
    "The principal signs a session mandate limiting maxBid, maxEscrow, and maxAppraisalSpend. The autonomous agent verifies this signature and refuses actions that exceed caps — before any x402 payment or commit is sent.",
  onChainTitle: "Escrow cap (on-chain)",
  onChainBody:
    "At commit, escrow is public on-chain. At reveal, the contract sets valid = (value > 0 && value ≤ escrow). A bid above escrow is recorded but excluded from clearing — escrow is still refunded at settle.",
  notOnChain:
    "maxBid and maxAppraisalSpend are not Soroban-enforced today; they are agent-side safety rails signed by the principal. Only escrow is the on-chain spending ceiling for the sealed bid value.",
};
