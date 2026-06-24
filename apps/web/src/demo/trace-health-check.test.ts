import assert from "node:assert/strict";
import { test } from "node:test";

import { DEMO_TRACE } from "./demo-trace.generated.js";
import {
  assertDemoTrace,
  DemoTraceHealthCheckError,
} from "./trace-health-check.js";

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
