import type { DemoTrace } from "./trace";

type UnknownRecord = Record<string, unknown>;

export class DemoTraceHealthCheckError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid demo trace:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "DemoTraceHealthCheckError";
  }
}

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

function requireNonEmptyArray(
  value: unknown,
  path: string,
  issues: string[],
): unknown[] | null {
  const array = requireArray(value, path, issues);
  if (array && array.length === 0) {
    issues.push(`${path} must contain at least one item`);
  }
  return array;
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

function checkMeta(value: unknown, issues: string[]): void {
  const meta = requireRecord(value, "meta", issues);
  if (!meta) return;

  requireString(meta.contractId, "meta.contractId", issues);
  requireNumber(meta.roundId, "meta.roundId", issues);
  requireNumber(meta.revealRound, "meta.revealRound", issues);
  requireString(meta.clearingRule, "meta.clearingRule", issues);
  requireString(meta.roundStatus, "meta.roundStatus", issues);
}

function checkLifecycle(value: unknown, issues: string[]): void {
  const lifecycle = requireNonEmptyArray(value, "lifecycle", issues);
  if (!lifecycle) return;

  lifecycle.forEach((value, index) => {
    const path = `lifecycle[${index}]`;
    const event = requireRecord(value, path, issues);
    if (!event) return;

    requireString(event.phase, `${path}.phase`, issues);
    requireString(event.label, `${path}.label`, issues);
    requireString(event.detail, `${path}.detail`, issues);
    requireString(event.status, `${path}.status`, issues);
  });
}

function checkBidders(value: unknown, issues: string[]): string[] {
  const bidders = requireNonEmptyArray(value, "bidders", issues);
  if (!bidders) return [];

  return bidders.flatMap((value, index) => {
    const path = `bidders[${index}]`;
    const bidder = requireRecord(value, path, issues);
    if (!bidder) return [];

    requireString(bidder.label, `${path}.label`, issues);
    requireString(bidder.address, `${path}.address`, issues);
    requireNumber(bidder.escrowUsdc, `${path}.escrowUsdc`, issues);
    if (bidder.bidUsdc !== null) {
      requireNumber(bidder.bidUsdc, `${path}.bidUsdc`, issues);
    }
    requireBoolean(bidder.revealed, `${path}.revealed`, issues);
    requireBoolean(bidder.valid, `${path}.valid`, issues);
    requireBoolean(bidder.winner, `${path}.winner`, issues);

    return typeof bidder.label === "string" && bidder.label.trim() !== ""
      ? [bidder.label]
      : [];
  });
}

function checkAgents(value: unknown, issues: string[]): void {
  const agents = requireNonEmptyArray(value, "agents", issues);
  if (!agents) return;

  agents.forEach((value, index) => {
    const path = `agents[${index}]`;
    const agent = requireRecord(value, path, issues);
    if (!agent) return;

    requireString(agent.name, `${path}.name`, issues);
    requireString(agent.principal, `${path}.principal`, issues);
    requireString(agent.sessionKey, `${path}.sessionKey`, issues);

    const mandate = requireRecord(agent.mandate, `${path}.mandate`, issues);
    if (mandate) {
      requireNumber(mandate.maxBidUsdc, `${path}.mandate.maxBidUsdc`, issues);
      requireNumber(mandate.maxEscrowUsdc, `${path}.mandate.maxEscrowUsdc`, issues);
      requireNumber(
        mandate.maxAppraisalSpendUsdc,
        `${path}.mandate.maxAppraisalSpendUsdc`,
        issues,
      );
      requireBoolean(mandate.cappedAtMaxBid, `${path}.mandate.cappedAtMaxBid`, issues);
    }

    const appraisal = requireRecord(agent.appraisal, `${path}.appraisal`, issues);
    if (appraisal) {
      requireNumber(appraisal.fairValue, `${path}.appraisal.fairValue`, issues);
      requireNumber(
        appraisal.suggestedMaxBid,
        `${path}.appraisal.suggestedMaxBid`,
        issues,
      );
      requireString(appraisal.inputsHash, `${path}.appraisal.inputsHash`, issues);
    }

    const x402 = requireRecord(agent.x402, `${path}.x402`, issues);
    if (x402) {
      requireNumber(x402.priceUsdc, `${path}.x402.priceUsdc`, issues);
      requireBoolean(x402.settled, `${path}.x402.settled`, issues);
    }
  });
}

function checkKeeper(value: unknown, issues: string[]): void {
  const keeper = requireRecord(value, "keeper", issues);
  if (!keeper) return;

  requireNumber(keeper.drandRound, "keeper.drandRound", issues);
  requireBoolean(keeper.blsVerifiedOnChain, "keeper.blsVerifiedOnChain", issues);
  requireNonEmptyArray(keeper.reveals, "keeper.reveals", issues)?.forEach(
    (reveal, index) => requireString(reveal, `keeper.reveals[${index}]`, issues),
  );
  requireString(keeper.clearWinner, "keeper.clearWinner", issues);
  requireNumber(keeper.contractBalanceFinal, "keeper.contractBalanceFinal", issues);
}

function checkSettlement(value: unknown, issues: string[]): void {
  const settlement = requireRecord(value, "settlement", issues);
  if (!settlement) return;

  requireNumber(
    settlement.operatorReceivedUsdc,
    "settlement.operatorReceivedUsdc",
    issues,
  );
  requireNumber(settlement.refundsUsdc, "settlement.refundsUsdc", issues);
  requireString(settlement.note, "settlement.note", issues);
}

function checkAuditor(
  value: unknown,
  bidderLabels: string[],
  issues: string[],
): void {
  const auditor = requireRecord(value, "auditor", issues);
  if (!auditor) return;

  requireString(auditor.source, "auditor.source", issues);
  requireString(auditor.secretHex, "auditor.secretHex", issues);
  requireString(auditor.publicHex, "auditor.publicHex", issues);

  const blobs = requireRecord(auditor.blobs, "auditor.blobs", issues);
  if (!blobs) return;

  bidderLabels.forEach((label) => {
    requireString(blobs[label], `auditor.blobs.${label}`, issues);
  });
}

export function assertDemoTrace(value: unknown): asserts value is DemoTrace {
  const issues: string[] = [];
  const trace = requireRecord(value, "trace", issues);

  if (trace) {
    checkMeta(trace.meta, issues);
    checkLifecycle(trace.lifecycle, issues);
    const bidderLabels = checkBidders(trace.bidders, issues);
    checkAgents(trace.agents, issues);
    checkKeeper(trace.keeper, issues);
    checkSettlement(trace.settlement, issues);
    checkAuditor(trace.auditor, bidderLabels, issues);
  }

  if (issues.length > 0) {
    throw new DemoTraceHealthCheckError(issues);
  }
}
