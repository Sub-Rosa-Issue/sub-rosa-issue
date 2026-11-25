// Copyright (c) 2026 Sub Rosa contributors
import { useMemo } from "react";
import { DEMO_TRACE } from "../demo/trace";
import { assertDemoTrace } from "../demo/trace-health-check";
import { verifyMilestones } from "../demo/demo-trace.checksum";

export type TraceHealthState =
  | { ok: true }
  | { ok: false; errorCode: string };

/**
 * Runs the demo trace health check synchronously on mount.
 *
 * - Calls assertDemoTrace to validate every required field.
 * - Calls verifyMilestones to confirm all required lifecycle phases are present.
 *
 * Returns { ok: true } when the trace passes both checks, or
 * { ok: false; errorCode: string } when either check fails.
 * The result is memoised: the trace is a static import so the check
 * only needs to run once per session.
 */
export function useTraceHealth(): TraceHealthState {
  return useMemo<TraceHealthState>(() => {
    try {
      assertDemoTrace(DEMO_TRACE);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, errorCode: `TRACE_INVALID: ${message}` };
    }

    const phases = (DEMO_TRACE as { lifecycle: Array<{ phase: string }> }).lifecycle.map(
      (e) => e.phase,
    );
    const result = verifyMilestones(phases);
    if (!result.ok) {
      return {
        ok: false,
        errorCode: `TRACE_MISSING_MILESTONES: ${result.missing.join(", ")}`,
      };
    }

    return { ok: true };
  }, []);
}
