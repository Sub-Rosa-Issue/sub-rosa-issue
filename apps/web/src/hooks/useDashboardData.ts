// Copyright (c) 2026 Sub Rosa contributors
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sdkErrorCode,
  StatusApiError,
  StatusJsonParseError,
  type SdkErrorCode,
} from "@sub-rosa/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardData } from "../dashboard/types";
import type { DashboardSnapshot } from "@sub-rosa/sdk";
import { DASHBOARD_FIXTURE } from "../dashboard/fixture";
import { assertDashboardData } from "../dashboard/fixture-health-check";
import { buildDashboardSnapshot } from "../dashboard/snapshot";
import { useTime } from "../lib/time";
import { useDrandCountdown } from "./useDrandCountdown";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const LIVE_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * What the dashboard may render. Only `ready` carries round data: the
 * `loading`, `empty` and `error` variants have no field that could hold a bid
 * amount, a bidder identity or sealed blob bytes, so those states cannot
 * display a bid the contract still treats as sealed.
 */
export type DashboardState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; code: SdkErrorCode }
  | { status: "ready"; data: DashboardData; stale: boolean };

export type UseDashboardDataResult = DashboardState & {
  /** A load is in flight. A `ready` round stays on screen while it reloads. */
  refreshing: boolean;
export interface UseDashboardDataResult {
  data: DashboardData | null;
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refetch: () => void;
};

export interface UseDashboardDataOptions {
  /** Defaults to `VITE_DASHBOARD_ENDPOINT`; blank selects the bundled fixture. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Determine whether dashboard data fetched at `fetchedAt` should be treated
 * as stale relative to `nowMs`.
 *
 * A missing or unparseable `fetchedAt` is treated as stale rather than
 * fresh: `Date.parse()` returns `NaN` for invalid input, and every
 * comparison against `NaN` (including `>`) evaluates to `false` in
 * JavaScript -- so without an explicit check, malformed timestamp data
 * would silently be reported as fresh instead of triggering the staleness
 * warning it's meant to guard against.
 */
export function isStale(fetchedAt: string | null | undefined, nowMs: number): boolean {
  if (!fetchedAt) {
    return true;
  }

  const fetchedTime = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedTime)) {
    return true;
  }

  return nowMs - fetchedTime > STALE_THRESHOLD_MS;
}

/** True when a successful response explicitly reports that there is no round. */
function reportsNoRound(json: unknown): boolean {
  if (json === null) return true;
  return typeof json === "object" && "round" in json && json.round === null;
}

/**
 * Load the dashboard payload. Resolves to `null` only when the endpoint
 * answers successfully with no round. Every failure -- including a payload
 * that arrives incomplete -- throws, so a partial round is never returned.
 */
export async function loadDashboardData(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DashboardData | null> {
  const response = await fetchImpl(endpoint);
  if (!response.ok) {
    throw new StatusApiError(response.status, { error: `HTTP ${response.status}` });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new StatusJsonParseError(response.status, { cause });
  }

  if (reportsNoRound(json)) {
    return null;
  }

  try {
    assertDashboardData(json);
  } catch (cause) {
    throw new StatusJsonParseError(response.status, { cause });
  }
  return json;
}

export function useDashboardData(
  options: UseDashboardDataOptions = {},
): UseDashboardDataResult {
  const { clock, scheduler } = useTime();
  const endpoint = (
    options.endpoint ?? (import.meta.env.VITE_DASHBOARD_ENDPOINT as string | undefined)
  )?.trim();
  const fetchImpl = options.fetchImpl;
  const useFixture = !endpoint;

  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(true);
  // Only the most recently started load may publish, so an older response can
  // never overwrite (or resurrect data over) the result of a newer one.
  const latestLoad = useRef(0);
  const [state, setState] = useState<Omit<UseDashboardDataResult, "snapshot" | "refetch">>(() => ({
    data: null,
    loading: true,
    error: null,
    stale: false,
  }));

  const fetchData = useCallback(async () => {
    const load = ++latestLoad.current;

    if (useFixture) {
      setState({
        status: "ready",
        data: DASHBOARD_FIXTURE,
        stale: isStale(DASHBOARD_FIXTURE.meta.fetchedAt, clock.nowMs()),
      });
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));

    // Each outcome is built from scratch: nothing from the previous state is
    // merged in, so a failure drops any round that was loaded before it.
    let next: DashboardState;
    try {
      const data = await loadDashboardData(endpoint, fetchImpl);
      next = data
        ? { status: "ready", data, stale: isStale(data.meta.fetchedAt, clock.nowMs()) }
        : { status: "empty" };
    } catch (e) {
      next = { status: "error", code: sdkErrorCode(e) };
    }

    if (load !== latestLoad.current) return;
    setState(next);
    setRefreshing(false);
  }, [endpoint, fetchImpl, useFixture, clock]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await fetchData();
    };

    void tick();

    let intervalHandle: ReturnType<typeof scheduler.setInterval> | undefined;
    if (!useFixture) {
      intervalHandle = scheduler.setInterval(() => void tick(), LIVE_POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      latestLoad.current++;
      if (intervalHandle !== undefined) {
        scheduler.clear(intervalHandle);
      }
    };
  }, [fetchData, useFixture, scheduler]);

  // Update stale status periodically
  const hasData = state.status === "ready";
  useEffect(() => {
    if (!hasData) return;

    const checkStale = () => {
      setState((s) => {
        if (s.status !== "ready") return s;
        const nowStale = isStale(s.data.meta.fetchedAt, clock.nowMs());
        return nowStale !== s.stale ? { ...s, stale: nowStale } : s;
      });
    };

    const handle = scheduler.setInterval(checkStale, 60_000);
    return () => scheduler.clear(handle);
  }, [hasData, clock, scheduler]);

  // Build the shared snapshot from the drand countdown for the current round's
  // reveal round.  useDrandCountdown returns a stable object that updates when
  // the drand published state changes, so the snapshot is always coherent.
  const revealRound = state.data?.round.revealRound ?? 0;
  const drand = useDrandCountdown(revealRound);

  const snapshot = useMemo<DashboardSnapshot | null>(() => {
    if (!state.data) return null;
    return buildDashboardSnapshot(
      state.data,
      drand.published,
      state.stale,
      drand.error,
    );
  }, [state.data, drand.published, drand.error, state.stale]);

  return {
    ...state,
    refreshing,
    snapshot,
    refetch: fetchData,
  };
}
