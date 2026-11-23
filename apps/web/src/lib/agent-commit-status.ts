// Copyright (c) 2026 Sub Rosa contributors
// Agent panel commit status, driven only by the bidder's SDK commit result.
import type { AgentCommitOutcome } from "@sub-rosa/agent/bidder";

export type { AgentCommitOutcome };

/** Commit outcomes keyed by bidder (session key) address. */
export type AgentCommitStatusMap = Readonly<Record<string, AgentCommitOutcome>>;

/**
 * Fold one SDK commit outcome into the map. Only the outcome's own bidder row
 * changes, and a pending or failed outcome never replaces a row the SDK
 * already confirmed as committed.
 */
export function applyCommitOutcome(
  rows: AgentCommitStatusMap,
  outcome: AgentCommitOutcome,
): AgentCommitStatusMap {
  const previous = rows[outcome.bidder];
  if (previous?.status === "committed" && outcome.status !== "committed") return rows;
  return { ...rows, [outcome.bidder]: outcome };
}

export interface AgentCommitRowView {
  committed: boolean;
  label: string;
  errorCode: string | null;
}

export function agentCommitRowView(outcome: AgentCommitOutcome | undefined): AgentCommitRowView {
  switch (outcome?.status) {
    case "committed":
      return { committed: true, label: "Committed", errorCode: null };
    case "failed":
      return { committed: false, label: "Not committed", errorCode: outcome.code };
    case "pending":
      return { committed: false, label: "Commit pending", errorCode: null };
    default:
      return { committed: false, label: "Not committed", errorCode: null };
  }
}
