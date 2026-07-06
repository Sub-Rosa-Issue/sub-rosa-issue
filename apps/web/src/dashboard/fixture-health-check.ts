import type { DashboardData, KeeperDryRunPhase, RoundStatus } from "./types";

type UnknownRecord = Record<string, unknown>;

export class DashboardDataHealthCheckError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid dashboard data:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "DashboardDataHealthCheckError";
  }
}

const VALID_STATUSES: RoundStatus[] = ["Open", "Revealing", "Cleared", "Settled", "Voided"];
const VALID_PHASES: KeeperDryRunPhase[] = [
  "awaiting-drand",
  "stale-open",
  "revealing",
  "awaiting-clear",
  "ready-to-clear",
  "ready-to-settle",
  "complete",
];
const VALID_CLEARING_RULES = ["HighestBid", "LowestBid"];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string,
  issues: string[],
): UnknownRecord | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  return value;
}

function requireArray(
  value: unknown,
  path: string,
  issues: string[],
): unknown[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return null;
  }
  return value;
}

function requireString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path} must be a non-empty string`);
  }
}

function requireNumber(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number`);
  }
}

function requireBoolean(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "boolean") {
    issues.push(`${path} must be a boolean`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  path: string,
  valid: T[],
  issues: string[],
): void {
  if (typeof value !== "string" || !valid.includes(value as T)) {
    issues.push(`${path} must be one of: ${valid.join(", ")}`);
  }
}

function requireNullableString(value: unknown, path: string, issues: string[]): void {
  if (value !== null && (typeof value !== "string" || value.trim() === "")) {
    issues.push(`${path} must be a non-empty string or null`);
  }
}

function requireNullableNumber(value: unknown, path: string, issues: string[]): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    issues.push(`${path} must be a finite number or null`);
  }
}

function requireNullableBoolean(value: unknown, path: string, issues: string[]): void {
  if (value !== null && typeof value !== "boolean") {
    issues.push(`${path} must be a boolean or null`);
  }
}

function checkMeta(value: unknown, issues: string[]): void {
  const meta = requireRecord(value, "meta", issues);
  if (!meta) return;

  requireString(meta.contractId, "meta.contractId", issues);
  requireNumber(meta.roundId, "meta.roundId", issues);
  requireString(meta.network, "meta.network", issues);
  requireOneOf(meta.clearingRule, "meta.clearingRule", VALID_CLEARING_RULES, issues);
  requireString(meta.fetchedAt, "meta.fetchedAt", issues);
}

function checkRound(value: unknown, issues: string[]): void {
  const round = requireRecord(value, "round", issues);
  if (!round) return;

  requireOneOf(round.status, "round.status", VALID_STATUSES, issues);
  requireNumber(round.commitDeadline, "round.commitDeadline", issues);
  requireNumber(round.revealDeadline, "round.revealDeadline", issues);
  requireNumber(round.revealRound, "round.revealRound", issues);
  requireNullableString(round.winner, "round.winner", issues);
  requireNullableNumber(round.winningBid, "round.winningBid", issues);
}

function checkKeeperAction(value: unknown, path: string, issues: string[]): void {
  const action = requireRecord(value, path, issues);
  if (!action) return;

  requireString(action.timestamp, `${path}.timestamp`, issues);
  requireString(action.action, `${path}.action`, issues);
  if (action.txHash !== undefined) {
    requireString(action.txHash, `${path}.txHash`, issues);
  }
  requireBoolean(action.success, `${path}.success`, issues);
}

function checkKeeper(value: unknown, issues: string[]): void {
  const keeper = requireRecord(value, "keeper", issues);
  if (!keeper) return;

  requireOneOf(keeper.currentPhase, "keeper.currentPhase", VALID_PHASES, issues);
  requireString(keeper.nextAction, "keeper.nextAction", issues);
  requireNullableString(keeper.lastActionAt, "keeper.lastActionAt", issues);

  const history = requireArray(keeper.actionHistory, "keeper.actionHistory", issues);
  if (history) {
    history.forEach((item, index) => {
      checkKeeperAction(item, `keeper.actionHistory[${index}]`, issues);
    });
  }
}

function checkBidder(value: unknown, path: string, issues: string[]): void {
  const bidder = requireRecord(value, path, issues);
  if (!bidder) return;

  requireString(bidder.address, `${path}.address`, issues);
  if (bidder.label !== undefined) {
    requireString(bidder.label, `${path}.label`, issues);
  }
  requireBoolean(bidder.committed, `${path}.committed`, issues);
  requireBoolean(bidder.revealed, `${path}.revealed`, issues);
  requireNullableBoolean(bidder.valid, `${path}.valid`, issues);
  requireBoolean(bidder.settled, `${path}.settled`, issues);
  requireNumber(bidder.escrowUsdc, `${path}.escrowUsdc`, issues);
  requireNullableNumber(bidder.bidUsdc, `${path}.bidUsdc`, issues);
}

function checkBidders(value: unknown, issues: string[]): void {
  const bidders = requireArray(value, "bidders", issues);
  if (!bidders) return;

  bidders.forEach((item, index) => {
    checkBidder(item, `bidders[${index}]`, issues);
  });
}

function checkSettlement(value: unknown, issues: string[]): void {
  if (value === null) return;

  const settlement = requireRecord(value, "settlement", issues);
  if (!settlement) return;

  requireNumber(settlement.operatorReceivedUsdc, "settlement.operatorReceivedUsdc", issues);
  requireNumber(settlement.refundsUsdc, "settlement.refundsUsdc", issues);
  requireNumber(settlement.contractBalance, "settlement.contractBalance", issues);
  requireString(settlement.note, "settlement.note", issues);
}

export function assertDashboardData(value: unknown): asserts value is DashboardData {
  const issues: string[] = [];
  const data = requireRecord(value, "data", issues);

  if (data) {
    checkMeta(data.meta, issues);
    checkRound(data.round, issues);
    checkKeeper(data.keeper, issues);
    checkBidders(data.bidders, issues);
    checkSettlement(data.settlement, issues);
  }

  if (issues.length > 0) {
    throw new DashboardDataHealthCheckError(issues);
  }
}
