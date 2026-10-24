// SPDX-License-Identifier: MIT
// Fetch helpers for the keeper status API. These are intentionally tiny
// wrappers over `fetch` so they work unchanged in Node 22+, the browser, or a
// Lambda — no `axios`, no generated client. Status endpoints are read-only
// and return stable typed JSON (see ../status.ts).

import { normalizeError } from "@sub-rosa/logging/errors";
import { systemScheduler, type Scheduler } from "@sub-rosa/time";
import { DEFAULT_RPC_TIMEOUT_MS } from "./network.js";
import type {
  KeeperHealthResponse,
  KeeperStatusResponse,
  KeeperRoundStatusView,
  ApiError,
} from "./status.js";

export interface StatusClientOptions {
  baseURL: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Injectable scheduler bounding each request (defaults to the system scheduler). */
  scheduler?: Scheduler;
  /** Contract the caller acts on; a status body for another contract is not ready. */
  contractId?: string;
  /** Round the caller acts on; a status body without this round is not ready. */
  roundId?: number | bigint | string;
}

/** Raised when a keeper status request does not answer within `timeoutMs`. */
export class KeeperStatusTimeoutError extends Error {
  readonly name = "KeeperStatusTimeoutError";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`keeper status request timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

export type KeeperNotReadyReason =
  | "timeout"
  | "contract_mismatch"
  | "round_mismatch"
  | "invalid_body"
  | "unavailable";

/** Readiness verdict: a live snapshot, or not-ready with no snapshot at all. */
export type KeeperReadiness =
  | { ready: true; snapshot: KeeperStatusResponse }
  | { ready: false; reason: KeeperNotReadyReason; error: string };

/** Strip `user:password@` userinfo from any URL embedded in a message. */
export function redactUrlUserinfo(message: string): string {
  return message.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1");
}

export class StatusApiError extends Error {
  status: number;
  data: ApiError;
  constructor(status: number, data: ApiError) {
    super(data.error ?? `status api returned ${status}`);
    this.name = "StatusApiError";
    this.status = status;
    this.data = data;
  }
}

/** Raised when a successful HTTP response body is empty or not valid JSON. */
export class StatusJsonParseError extends Error {
  readonly name = "StatusJsonParseError";
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`status api returned ${status} with invalid JSON body`, options);
    this.status = status;
  }
}

function fullURL(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${clean}`;
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  const text = await res.text();
  if (!text.trim()) return { error: `status api returned ${res.status}` };
  try {
    return JSON.parse(text) as ApiError;
  } catch {
    return { error: "invalid JSON body" };
  }
}

async function parseSuccessBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new StatusJsonParseError(res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new StatusJsonParseError(res.status, { cause });
  }
}

export class KeeperStatusClient {
  readonly baseURL: string;
  readonly fetchImpl: typeof fetch;
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
  readonly scheduler: Scheduler;
  readonly contractId?: string;
  readonly roundId?: string;
  #lastSnapshot: KeeperStatusResponse | null = null;

  constructor(opts: StatusClientOptions) {
    this.baseURL = opts.baseURL;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.headers = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.scheduler = opts.scheduler ?? systemScheduler;
    this.contractId = opts.contractId;
    this.roundId = opts.roundId === undefined ? undefined : String(opts.roundId);
    if (!this.fetchImpl) {
      throw new Error(
        "No global fetch found. Pass `fetchImpl` in StatusClientOptions.",
      );
    }
  }

  async getStatus(signal?: AbortSignal): Promise<KeeperStatusResponse> {
    return this.getJSON<KeeperStatusResponse>("/status", signal);
  }

  /** Last snapshot accepted by {@link readiness}; null after any not-ready read. */
  get lastSnapshot(): KeeperStatusResponse | null {
    return this.#lastSnapshot;
  }

  /**
   * Read `/status` and decide readiness. A timeout, transport/HTTP failure, or
   * a body for another contract or without the configured round is not ready
   * and drops the previously accepted snapshot instead of keeping it.
   */
  async readiness(signal?: AbortSignal): Promise<KeeperReadiness> {
    let verdict: KeeperReadiness;
    try {
      verdict = this.#judge(await this.getStatus(signal));
    } catch (error) {
      const timeout = error instanceof KeeperStatusTimeoutError;
      const message = normalizeError(error).message || "keeper status request failed";
      verdict = { ready: false, reason: timeout ? "timeout" : "unavailable", error: redactUrlUserinfo(message) };
    }
    this.#lastSnapshot = verdict.ready ? verdict.snapshot : null;
    return verdict;
  }

  #judge(body: KeeperStatusResponse): KeeperReadiness {
    if (!body || typeof body !== "object" || typeof body.contractId !== "string" || !Array.isArray(body.rounds)) {
      return { ready: false, reason: "invalid_body", error: "keeper status body is malformed" };
    }
    if (this.contractId !== undefined && body.contractId !== this.contractId) {
      return { ready: false, reason: "contract_mismatch", error: "keeper status is for a different contract" };
    }
    if (this.roundId !== undefined && !body.rounds.some((round) => round?.roundId === this.roundId)) {
      return { ready: false, reason: "round_mismatch", error: `keeper status does not report round ${this.roundId}` };
    }
    return { ready: true, snapshot: body };
  }

  async getRound(roundId: number | bigint | string, signal?: AbortSignal): Promise<KeeperRoundStatusView> {
    return this.getJSON<KeeperRoundStatusView>(`/status/rounds/${roundId}`, signal);
  }

  async getHealth(signal?: AbortSignal): Promise<KeeperHealthResponse> {
    return this.getJSON<KeeperHealthResponse>("/status/health", signal);
  }

  async healthz(signal?: AbortSignal): Promise<{ ok: boolean; [k: string]: unknown }> {
    return this.getJSON<{ ok: boolean; [k: string]: unknown }>("/healthz", signal);
  }

  async getJSON<T>(path: string, callerSignal?: AbortSignal): Promise<T> {
    const url = fullURL(this.baseURL, path);
    const controller = new AbortController();
    const timeoutError = new KeeperStatusTimeoutError(this.timeoutMs);
    let onTimeout!: () => void;
    // Racing the scheduler timer also bounds a fetch that ignores the abort signal.
    const timedOut = new Promise<never>((_resolve, reject) => {
      onTimeout = () => {
        controller.abort(timeoutError);
        reject(timeoutError);
      };
    });
    const timer = this.scheduler.setTimeout(onTimeout, this.timeoutMs);
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    const request = (async () => {
      const res = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json", ...this.headers }, signal: controller.signal });
      if (!res.ok) {
        const body = await parseErrorBody(res);
        throw new StatusApiError(res.status, body);
      }
      return parseSuccessBody<T>(res);
    })();
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      this.scheduler.clear(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
      request.catch(() => {});
    }
  }
}

// Convenience — one-shot status fetch without constructing a client.
export async function fetchKeeperStatus(baseURL: string): Promise<KeeperStatusResponse> {
  return new KeeperStatusClient({ baseURL }).getStatus();
}
