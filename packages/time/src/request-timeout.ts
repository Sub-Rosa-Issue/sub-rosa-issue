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
 * Re-expose `response` with a body that keeps the deadline armed: the timer is
 * released only once the body is fully read, cancelled or has failed. If the
 * deadline (or the caller's signal) fires while a read is pending, that read
 * rejects with the abort reason and the source stream is cancelled, so a peer
 * that sends headers and then stalls cannot hold the caller forever.
 */
function bindBodyToDeadline(
  response: Response,
  signal: AbortSignal,
  release: () => void,
): Response {
  if (!response.body) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
    release();
  };

  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const onAbort = () => {
    const reason = signal.reason;
    reader.cancel(reason).catch(() => undefined);
    try {
      streamController?.error(reason);
    } catch {
      // The stream already closed or errored; nothing left to signal.
    }
    finish();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      signal.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish();
        // An abort that already errored the stream wins; ignore the late throw.
        try {
          controller.error(signal.aborted ? signal.reason : error);
        } catch {
          // already errored by the abort handler
        }
      }
    },
    cancel(reason) {
      const cancellation = reader.cancel(reason);
      finish();
      return cancellation;
    },
  });

  const bound = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperty(bound, "url", { value: response.url });
  Object.defineProperty(bound, "redirected", { value: response.redirected });
  Object.defineProperty(bound, "type", { value: response.type });
  return bound;
}

/**
 * `fetch` bounded by a timeout. The timer covers connecting, receiving the
 * response headers and reading the body: the returned response's body stays
 * under the same deadline until it is fully consumed, so `await res.json()`
 * on a stalled body rejects with {@link RequestTimeoutError} rather than
 * hanging. It aborts the request and rejects with {@link RequestTimeoutError}.
 * A caller `init.signal` still cancels the request (and an in-flight body
 * read) and its own abort reason is preserved. The error never includes the
 * URL, which may carry credentials.
 */
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs);
  const scheduler = options.scheduler ?? systemScheduler;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const callerSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);

  if (callerSignal?.aborted) {
    throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  const timeoutError = new RequestTimeoutError(timeoutMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = scheduler.setTimeout(() => controller.abort(timeoutError), timeoutMs);

  const release = () => {
    scheduler.clear(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  };

  let response: Response;
  try {
    response = await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    release();
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  }
  if (controller.signal.aborted) {
    const reason = controller.signal.reason;
    void response.body?.cancel(reason).catch(() => undefined);
    release();
    throw reason;
  }
  return bindBodyToDeadline(response, controller.signal, release);
}
