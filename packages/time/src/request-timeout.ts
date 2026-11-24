import { systemScheduler } from "./system.js";
import type { Scheduler } from "./types.js";

/**
 * Shared default timeout (ms) for every external request the SDK, keeper,
 * appraisal client and Drand tooling make. One value, so a hung peer cannot
 * stall one component indefinitely while another gives up.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Smallest accepted per-request timeout override (ms). */
export const MIN_REQUEST_TIMEOUT_MS = 100;

/** Largest accepted per-request timeout override (ms). */
export const MAX_REQUEST_TIMEOUT_MS = 300_000;

/** Raised when an external request does not answer within its timeout. */
export class RequestTimeoutError extends Error {
  readonly name = "RequestTimeoutError";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Resolve a timeout override. `undefined` yields the shared default; anything
 * that is not a finite integer within [MIN, MAX] throws a `RangeError` so a
 * typo (`0`, `NaN`, `1e9`) can never silently disable the bound.
 */
export function resolveRequestTimeoutMs(value?: number): number {
  if (value === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    value < MIN_REQUEST_TIMEOUT_MS ||
    value > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new RangeError(
      `request timeout must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS} ms, got ${value}`,
    );
  }
  return value;
}

export interface FetchWithTimeoutOptions {
  /** Timeout in ms. Default: {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Fetch implementation. Default: `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Scheduler used for the timer. Default: the system scheduler. */
  scheduler?: Scheduler;
}

/**
 * `fetch` bounded by a timeout. The timer covers connecting and receiving the
 * response headers; it aborts the request and rejects with
 * {@link RequestTimeoutError}. A caller `init.signal` still cancels the request
 * and its own abort reason is preserved. The error never includes the URL,
 * which may carry credentials.
 */
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);
  const scheduler = options.scheduler ?? systemScheduler;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const callerSignal = init.signal ?? undefined;

  if (callerSignal?.aborted) {
    throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  const timeoutError = new RequestTimeoutError(timeoutMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = scheduler.setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    scheduler.clear(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
