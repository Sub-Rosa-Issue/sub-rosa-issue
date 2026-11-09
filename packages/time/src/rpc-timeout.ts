// Copyright (c) 2026 Sub Rosa contributors
import { systemScheduler } from "./system.js";
import type { Scheduler } from "./types.js";

/**
 * Shared default timeout (ms) bounding every external HTTP / RPC request
 * across the SDK, keeper, appraisal client, and Drand client.
 */
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

function sanitizeOperationLabel(operation?: string): string | undefined {
  if (!operation) return undefined;
  const cleaned = operation
    .replace(/\bhttps?:\/\/[^\s)]+/gi, "[rpc-endpoint]")
    .replace(/\b[^\s:@/]+:[^\s@/]+@[^\s)]+/g, "[redacted-endpoint]")
    .replace(/\?[^\s)]+/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Typed error raised when an external HTTP or RPC request does not complete
 * within the configured timeout window. Never embeds raw URLs, query strings,
 * or credentials.
 */
export class ExternalRpcTimeoutError extends Error {
  override readonly name = "ExternalRpcTimeoutError";
  readonly code = "RPC_REQUEST_TIMEOUT";
  readonly timeoutMs: number;
  readonly operation?: string;

  constructor(
    timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
    operation?: string,
    options?: ErrorOptions,
  ) {
    const safeOp = sanitizeOperationLabel(operation);
    const label = safeOp ? ` (${safeOp})` : "";
    super(`external RPC request${label} timed out after ${timeoutMs}ms`, options);
    this.timeoutMs = timeoutMs;
    this.operation = safeOp;
  }
}

export interface RpcTimeoutOptions {
  /** Per-request timeout in milliseconds. Defaults to {@link DEFAULT_RPC_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injectable scheduler (defaults to {@link systemScheduler}). */
  scheduler?: Scheduler;
  /** Optional caller-supplied abort signal to chain with the timeout signal. */
  signal?: AbortSignal;
  /** Diagnostic operation label (never a URL with query string or credentials). */
  operation?: string;
  /** Optional factory to produce a domain-specific timeout error. */
  createTimeoutError?: (timeoutMs: number, operation?: string) => Error;
}

export interface FetchRpcTimeoutOptions extends RpcTimeoutOptions {
  /** Custom `fetch` implementation (defaults to `globalThis.fetch`). */
  fetchImpl?: typeof fetch;
}

export function assertValidRpcTimeoutMs(
  timeoutMs: number | undefined = DEFAULT_RPC_TIMEOUT_MS,
  label = "timeoutMs",
): number {
  const resolved = timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(
      `${label} must be a positive finite number of milliseconds, got ${String(timeoutMs)}`,
    );
  }
  return resolved;
}

/**
 * Bound an external async RPC/HTTP operation with a shared timeout and
 * `AbortSignal`. Rejects with {@link ExternalRpcTimeoutError} (or the custom
 * error from `createTimeoutError`) if the operation does not settle in time,
 * even when the underlying transport ignores the `AbortSignal`.
 */
export async function withRpcTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: RpcTimeoutOptions = {},
): Promise<T> {
  const timeoutMs = assertValidRpcTimeoutMs(
    options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
  );
  const scheduler = options.scheduler ?? systemScheduler;
  const controller = new AbortController();
  const timeoutError = options.createTimeoutError
    ? options.createTimeoutError(timeoutMs, options.operation)
    : new ExternalRpcTimeoutError(timeoutMs, options.operation);

  let timedOutByTimer = false;
  let onTimeout!: () => void;

  const callerSignal = options.signal;
  if (callerSignal?.aborted) {
    const reason =
      callerSignal.reason instanceof Error
        ? callerSignal.reason
        : timeoutError;
    controller.abort(reason);
    throw reason;
  }

  const timeoutSignal =
    scheduler === systemScheduler && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  const timedOut = new Promise<never>((_resolve, reject) => {
    onTimeout = () => {
      timedOutByTimer = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    };
  });

  const timer = scheduler.setTimeout(onTimeout, timeoutMs);
  const onTimeoutSignalAbort = () => onTimeout();
  timeoutSignal?.addEventListener("abort", onTimeoutSignalAbort, { once: true });

  const onCallerAbort = () => {
    const reason =
      callerSignal?.reason instanceof Error
        ? callerSignal.reason
        : timeoutError;
    controller.abort(reason);
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const pending = (async () => {
    try {
      return await work(controller.signal);
    } catch (error) {
      if (timedOutByTimer || timeoutSignal?.aborted) {
        throw timeoutError;
      }
      throw error;
    }
  })();

  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    scheduler.clear(timer);
    timeoutSignal?.removeEventListener("abort", onTimeoutSignalAbort);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    pending.catch(() => {});
  }
}

/**
 * Execute an HTTP `fetch` bounded by {@link DEFAULT_RPC_TIMEOUT_MS} (or an
 * explicit `options.timeoutMs` override).
 */
export async function fetchWithRpcTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchRpcTimeoutOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No global fetch found. Pass `fetchImpl` in options.");
  }
  const callerSignal = options.signal ?? (init.signal ?? undefined);
  return withRpcTimeout(
    (signal) => fetchImpl(input, { ...init, signal }),
    {
      ...options,
      signal: callerSignal,
      operation: options.operation ?? "fetch",
    },
  );
}
