import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeeperRoundStatusView, RoundStatus } from "./status.js";
import {
  ACTIVE_ROUND_STATUSES,
  ERROR_ROUND_STATUSES,
  TERMINAL_ROUND_STATUSES,
  classifyRoundStatus,
  isActiveRoundStatus,
  isErrorRoundStatus,
  isKeeperRoundActive,
  isKeeperRoundSettlementPending,
  isKeeperRoundTerminal,
  isTerminalRoundStatus,
  roundStatusLabel,
} from "./round-status.js";

const ALL_STATUSES: RoundStatus[] = [
  "Unknown",
  "Open",
  "Revealing",
  "Cleared",
  "Settled",
  "Voided",
  "NotFound",
];

function viewFor(status: RoundStatus, settlement: KeeperRoundStatusView["settlement"] = "none"): KeeperRoundStatusView {
  return {
    roundId: "1",
    status,
    phase: "complete",
    nextAction: "none",
    commitDeadline: null,
    revealDeadline: null,
    revealRound: null,
    revealReady: false,
    commitClosed: false,
    revealWindowOpen: false,
    voidableAfter: null,
    bidderCount: null,
    revealedCount: null,
    winner: null,
    winningValue: null,
    clearingRule: null,
    settlement,
    lastKeeperAction: null,
    lastError: null,
    retryCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("round-status classification", () => {
  it("partitions every status into exactly one class", () => {
    const covered = new Set([
      ...ACTIVE_ROUND_STATUSES,
      ...TERMINAL_ROUND_STATUSES,
      ...ERROR_ROUND_STATUSES,
    ]);
    assert.equal(covered.size, ALL_STATUSES.length);
    for (const status of ALL_STATUSES) {
      assert.ok(covered.has(status), `status ${status} must be classified`);
    }
  });

  it("classifies active statuses", () => {
    for (const status of ["Open", "Revealing", "Cleared"] as RoundStatus[]) {
      assert.equal(isActiveRoundStatus(status), true);
      assert.equal(classifyRoundStatus(status), "active");
    }
  });

  it("classifies terminal statuses", () => {
    for (const status of ["Settled", "Voided"] as RoundStatus[]) {
      assert.equal(isTerminalRoundStatus(status), true);
      assert.equal(classifyRoundStatus(status), "terminal");
    }
  });

  it("classifies error statuses", () => {
    for (const status of ["Unknown", "NotFound"] as RoundStatus[]) {
      assert.equal(isErrorRoundStatus(status), true);
      assert.equal(classifyRoundStatus(status), "error");
    }
  });

  it("does not double-count across buckets", () => {
    for (const status of ALL_STATUSES) {
      const hits =
        Number(isActiveRoundStatus(status)) +
        Number(isTerminalRoundStatus(status)) +
        Number(isErrorRoundStatus(status));
      assert.equal(hits, 1, `status ${status} should match exactly one predicate`);
    }
  });
});

describe("roundStatusLabel", () => {
  it("returns a human-readable label for every status", () => {
    for (const status of ALL_STATUSES) {
      const label = roundStatusLabel(status);
      assert.ok(typeof label === "string" && label.length > 0);
      assert.ok(label.toLowerCase().startsWith(status.toLowerCase()));
    }
  });
});

describe("keeper round view helpers", () => {
  it("mirror status classification", () => {
    assert.equal(isKeeperRoundActive(viewFor("Open")), true);
    assert.equal(isKeeperRoundActive(viewFor("Settled")), false);
    assert.equal(isKeeperRoundTerminal(viewFor("Voided")), true);
    assert.equal(isKeeperRoundTerminal(viewFor("Revealing")), false);
  });

  it("treats pending and submitted settlement as pending", () => {
    assert.equal(isKeeperRoundSettlementPending(viewFor("Cleared", "pending")), true);
    assert.equal(isKeeperRoundSettlementPending(viewFor("Cleared", "submitted")), true);
    assert.equal(isKeeperRoundSettlementPending(viewFor("Cleared", "none")), false);
    assert.equal(isKeeperRoundSettlementPending(viewFor("Settled", "terminal")), false);
  });
});
