// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEMO_TRACE } from "./demo-trace.generated.js";
import {
  assertDemoTrace,
  DemoTraceHealthCheckError,
} from "./trace-health-check.js";
import {
  computeMilestoneChecksum,
  LIFE_CYCLE_PHASES_CHECKSUM,
  verifyMilestones,
} from "./demo-trace.checksum.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("canonical generated demo trace contains every field required by the UI", () => {
  assert.doesNotThrow(() => assertDemoTrace(DEMO_TRACE));
});

test("health check identifies a missing required field by its trace path", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    meta: { contractId?: string };
  };
  delete invalidTrace.meta.contractId;

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    (error: unknown) => {
      assert.ok(error instanceof DemoTraceHealthCheckError);
      assert.match(error.message, /meta\.contractId must be a non-empty string/);
      return true;
    },
  );
});

test("health check requires an auditor evidence blob for every bidder", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    auditor: { blobs: Record<string, string> };
  };
  delete invalidTrace.auditor.blobs["agent-alpha"];

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    /auditor\.blobs\.agent-alpha must be a non-empty string/,
  );
});

test("health check requires at least one lifecycle event", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    lifecycle: unknown[];
  };
  invalidTrace.lifecycle = [];

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    /lifecycle must contain at least one item/,
  );
});

test("checksum matches the generated trace lifecycle phases", () => {
  assert.strictEqual(computeMilestoneChecksum(), LIFE_CYCLE_PHASES_CHECKSUM);
});

test("every required milestone phase is present in the trace lifecycle", () => {
  const phases = DEMO_TRACE.lifecycle.map((e: { phase: string }) => e.phase);
  const result = verifyMilestones(phases);
  assert.ok(
    result.ok,
    result.ok ? "" : `Missing milestones: ${result.missing.join(", ")}`,
  );
});

test("receipt milestone — settlement section is present", () => {
  assert.ok(
    "settlement" in DEMO_TRACE,
    "trace must have a settlement section (receipt)",
  );
  const settlement = (DEMO_TRACE as Record<string, unknown>).settlement;
  assert.ok(
    typeof settlement === "object" && settlement !== null,
    "settlement must be an object",
  );
});

test("checksum fails when a required milestone is removed from lifecycle", () => {
  const stripped = DEMO_TRACE.lifecycle.filter(
    (e: { phase: string }) => e.phase !== "open_reveal",
  );
  const phases = stripped.map((e: { phase: string }) => e.phase);
  const result = verifyMilestones(phases);
  assert.ok(!result.ok);
  assert.ok(result.ok === false && result.missing.includes("open_reveal"));
});

test("demo trace contains no secret seeds", () => {
  const json = JSON.stringify(DEMO_TRACE);
  assert.ok(
    !/\bS[A-Z2-7]{55}\b/.test(json),
    "Demo trace must never contain secret seeds",
  );
});

test("health check rejects a demo trace containing an injected secret seed", () => {
  const FAKE_SEED = "SBGWGH5QWWZ2WKKG24YCQAL35EWB64L35KAGL3E7N7H5K3T4K5K3T4K5";
  const taintedTrace = structuredClone(DEMO_TRACE) as unknown as {
    agents: Array<{ sessionKey: string }>;
  };
  taintedTrace.agents[0].sessionKey = FAKE_SEED;

  assert.throws(
    () => assertDemoTrace(taintedTrace),
    (error: unknown) => {
      assert.ok(error instanceof DemoTraceHealthCheckError);
      assert.ok(error.issues.some((i) => i.includes("must not contain a secret seed")));
      return true;
    },
  );
});

import "./demo-a11y-smoke.test";


