// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { DASHBOARD_FIXTURE } from "./fixture.js";
import { DEMO_TRACE } from "../demo/demo-trace.generated.js";
import {
  assertDashboardData,
  DashboardDataHealthCheckError,
} from "./fixture-health-check.js";

test("bundled dashboard fixture contains every field required by the UI", () => {
  assert.doesNotThrow(() => assertDashboardData(DASHBOARD_FIXTURE));
});

test("dashboard fixture agrees with the committed demo trace", () => {
  assert.equal(DASHBOARD_FIXTURE.meta.contractId, DEMO_TRACE.meta.contractId);
  assert.equal(DASHBOARD_FIXTURE.meta.roundId, DEMO_TRACE.meta.roundId);
  assert.equal(DASHBOARD_FIXTURE.round.revealRound, DEMO_TRACE.meta.revealRound);
  assert.equal(DASHBOARD_FIXTURE.meta.fetchedAt, DEMO_TRACE.meta.recordedAt);
  assert.equal(DASHBOARD_FIXTURE.round.status, DEMO_TRACE.meta.roundStatus);
  assert.equal(DASHBOARD_FIXTURE.round.winner, DEMO_TRACE.keeper.clearWinner);
  assert.equal(DASHBOARD_FIXTURE.round.winningBid, DEMO_TRACE.settlement.operatorReceivedUsdc);
  assert.equal(DASHBOARD_FIXTURE.settlement?.contractBalance, DEMO_TRACE.keeper.contractBalanceFinal);
  assert.deepEqual(
    DASHBOARD_FIXTURE.bidders.map(({ address, bidUsdc }) => ({ address, bidUsdc })),
    DEMO_TRACE.bidders.map(({ address, bidUsdc }) => ({ address, bidUsdc })),
  );
});

test("health check identifies a missing required field by its path", () => {
  const invalidData = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    meta: { contractId?: string };
  };
  delete invalidData.meta.contractId;

  assert.throws(
    () => assertDashboardData(invalidData),
    (error: unknown) => {
      assert.ok(error instanceof DashboardDataHealthCheckError);
      assert.match(error.message, /meta\.contractId must be a non-empty string/);
      return true;
    },
  );
});

test("health check rejects invalid round status values", () => {
  const invalidData = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    round: { status: string };
  };
  invalidData.round.status = "InvalidStatus";

  assert.throws(
    () => assertDashboardData(invalidData),
    /round\.status must be one of: Open, Revealing, Cleared, Settled, Voided/,
  );
});

test("health check rejects invalid keeper phase values", () => {
  const invalidData = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    keeper: { currentPhase: string };
  };
  invalidData.keeper.currentPhase = "invalid-phase";

  assert.throws(
    () => assertDashboardData(invalidData),
    /keeper\.currentPhase must be one of:/,
  );
});

test("health check validates bidder entries", () => {
  const invalidData = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    bidders: Array<{ address?: string }>;
  };
  delete invalidData.bidders[0].address;

  assert.throws(
    () => assertDashboardData(invalidData),
    /bidders\[0\]\.address must be a non-empty string/,
  );
});

test("health check allows null settlement for non-settled rounds", () => {
  const dataWithNullSettlement = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    settlement: null;
  };
  dataWithNullSettlement.settlement = null;

  assert.doesNotThrow(() => assertDashboardData(dataWithNullSettlement));
});

test("health check validates keeper action history entries", () => {
  const invalidData = structuredClone(DASHBOARD_FIXTURE) as unknown as {
    keeper: { actionHistory: Array<{ timestamp?: string }> };
  };
  delete invalidData.keeper.actionHistory[0].timestamp;

  assert.throws(
    () => assertDashboardData(invalidData),
    /keeper\.actionHistory\[0\]\.timestamp must be a non-empty string/,
  );
});
