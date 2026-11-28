// Copyright (c) 2026 Sub Rosa contributors
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

  // Canonical shape: exactly one settle phase, and it must be the last event.
  const phases = lifecycle.map((event) =>
    isRecord(event) && typeof event.phase === "string" ? event.phase : null,
  );
  const settleCount = phases.filter((p) => p === "settle").length;
  if (settleCount === 0) {
    issues.push("lifecycle must include a settle phase");
  } else if (settleCount > 1) {
    issues.push("lifecycle must include exactly one settle phase");
  }
  if (phases.length > 0 && phases[phases.length - 1] !== "settle") {
    issues.push("lifecycle must end with the settle phase");
  }
}

function checkBidders(
  value: unknown,
  issues: string[],
): { labels: string[]; addresses: string[] } {
  const bidders = requireNonEmptyArray(value, "bidders", issues);
  if (!bidders) return [];

  const labels: string[] = [];
  const addresses: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  bidders.forEach((value, index) => {
    const path = `bidders[${index}]`;
    const bidder = requireRecord(value, path, issues);
    if (!bidder) return;

    requireString(bidder.label, `${path}.label`, issues);
    requireString(bidder.address, `${path}.address`, issues);
    requireNumber(bidder.escrowUsdc, `${path}.escrowUsdc`, issues);
    if (bidder.bidUsdc !== null) {
      requireNumber(bidder.bidUsdc, `${path}.bidUsdc`, issues);
    }
    requireBoolean(bidder.revealed, `${path}.revealed`, issues);
    requireBoolean(bidder.valid, `${path}.valid`, issues);
    requireBoolean(bidder.winner, `${path}.winner`, issues);

    if (typeof bidder.label === "string" && bidder.label.trim() !== "") {
      if (seen.has(bidder.label)) duplicates.add(bidder.label);
      seen.add(bidder.label);
      labels.push(bidder.label);
    }
    if (typeof bidder.address === "string" && bidder.address.trim() !== "") {
      addresses.push(bidder.address);
    }
  });

  if (duplicates.size > 0) {
    issues.push(
      `bidders must not contain duplicate labels: ${[...duplicates].join(", ")}`,
    );
  }

  return { labels, addresses };
}

function checkAgents(value: unknown, bidderLabels: string[], issues: string[]): void {
  const agents = requireNonEmptyArray(value, "agents", issues);
  if (!agents) return;

  const agentNames = new Set<string>();

  agents.forEach((value, index) => {
    const path = `agents[${index}]`;
    const agent = requireRecord(value, path, issues);
    if (!agent) return;

    requireString(agent.name, `${path}.name`, issues);
    requireString(agent.principal, `${path}.principal`, issues);
    requireString(agent.sessionKey, `${path}.sessionKey`, issues);

    // Commit hash is required for every agent in the canonical trace.
    requireString(agent.commitTx, `${path}.commitTx`, issues);

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

    if (typeof agent.name === "string" && agent.name.trim() !== "") {
      agentNames.add(agent.name);
    }
  });

  // Every bidder must have a matching agent record and vice versa.
  for (const label of bidderLabels) {
    if (!agentNames.has(label)) {
      issues.push(`bidder "${label}" has no matching agent record`);
    }
  }
  for (const name of agentNames) {
    if (!bidderLabels.includes(name)) {
      issues.push(`agent "${name}" has no matching bidder record`);
    }
  }
}

function checkKeeper(
  value: unknown,
  bidderLabels: string[],
  bidderAddresses: string[],
  issues: string[],
): void {
  const keeper = requireRecord(value, "keeper", issues);
  if (!keeper) return;

  requireNumber(keeper.drandRound, "keeper.drandRound", issues);
  requireBoolean(keeper.blsVerifiedOnChain, "keeper.blsVerifiedOnChain", issues);

  const reveals = requireNonEmptyArray(keeper.reveals, "keeper.reveals", issues);
  if (reveals) {
    const revealSet = new Set<string>();
    const duplicates = new Set<string>();
    reveals.forEach((reveal, index) => {
      requireString(reveal, `keeper.reveals[${index}]`, issues);
      if (typeof reveal === "string" && reveal.trim() !== "") {
        if (revealSet.has(reveal)) duplicates.add(reveal);
        revealSet.add(reveal);
      }
    });

    if (duplicates.size > 0) {
      issues.push(
        `keeper.reveals must not contain duplicates: ${[...duplicates].join(", ")}`,
      );
    }

    // Reveal entries are human-readable strings like "agent-alpha → 700 USDC";
    // match each bidder by its "label →" prefix instead of the raw string.
    const revealLabels = new Map<string, number>();
    for (const reveal of revealSet) {
      const label = bidderLabels.find(
        (candidate) => reveal === candidate || reveal.startsWith(`${candidate} →`),
      );
      if (label) {
        revealLabels.set(label, (revealLabels.get(label) ?? 0) + 1);
      } else {
        issues.push(`keeper.reveals include unknown bidder "${reveal}"`);
      }
    }
    for (const label of bidderLabels) {
      const count = revealLabels.get(label) ?? 0;
      if (count === 0) {
        issues.push(`keeper.reveals omit bidder "${label}"`);
      } else if (count > 1) {
        issues.push(
          `keeper.reveals must not contain duplicates: "${label}" appears ${count} times`,
        );
      }
    }
  }

  requireString(keeper.clearWinner, "keeper.clearWinner", issues);
  if (
    typeof keeper.clearWinner === "string" &&
    keeper.clearWinner.trim() !== "" &&
    // The canonical trace records the winner's Stellar address, which must
    // belong to one of the bidders (or be the bidder label itself).
    !bidderLabels.includes(keeper.clearWinner) &&
    !bidderAddresses.includes(keeper.clearWinner)
  ) {
    issues.push(`keeper.clearWinner "${keeper.clearWinner}" is not a bidder`);
  }
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

function checkNoSecretSeeds(value: unknown, path: string, issues: string[]): void {
  if (typeof value === "string") {
    if (/\bS[A-Z2-7]{55}\b/.test(value)) {
      issues.push(`${path} must not contain a secret seed`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkNoSecretSeeds(item, `${path}[${i}]`, issues));
    return;
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      checkNoSecretSeeds(v, `${path}.${k}`, issues);
    }
  }
}

export function assertDemoTrace(value: unknown): asserts value is DemoTrace {
  const issues: string[] = [];
  const trace = requireRecord(value, "trace", issues);

  if (trace) {
    checkNoSecretSeeds(trace, "trace", issues);
    checkMeta(trace.meta, issues);
    checkLifecycle(trace.lifecycle, issues);
    const { labels: bidderLabels, addresses: bidderAddresses } = checkBidders(
      trace.bidders,
      issues,
    );
    checkAgents(trace.agents, bidderLabels, issues);
    checkKeeper(trace.keeper, bidderLabels, bidderAddresses, issues);
    checkSettlement(trace.settlement, issues);
    checkAuditor(trace.auditor, bidderLabels, issues);
  }

  if (issues.length > 0) {
    throw new DemoTraceHealthCheckError(issues);
  }
}
