// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

import { fetchWithTimeout } from "@sub-rosa/time";

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

const API = process.env.DRAND_API_URL ?? "https://api.drand.sh";

/** Stable error category for every HTTP 3xx / opaque redirect from Drand HTTP. */
export const DRAND_HTTP_REDIRECT_CATEGORY = "http_redirect" as const;

export interface ChainInfo {
  public_key: string; // compressed G2, hex (96 bytes)
  period: number; // seconds
  genesis_time: number; // unix seconds
  hash: string;
  schemeID: string;
}

export interface Beacon {
  round: number;
  randomness: string;
  signature: string; // compressed G1, hex (48 bytes)
}

/** True for HTTP 3xx statuses that would otherwise trigger a redirect. */
export function isHttpRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * Raised when a Drand chain-info or beacon fetch receives a redirect instead of
 * following it. The `Location` header value is never included in the message,
 * on the error object, or in any diagnostic payload derived from it.
 */
export class DrandRedirectError extends Error {
  readonly name = "DrandRedirectError";
  /** One stable category for every 3xx / opaque redirect response. */
  readonly category = DRAND_HTTP_REDIRECT_CATEGORY;
  readonly status: number;
  readonly resource: "chain-info" | "beacon";

  constructor(resource: "chain-info" | "beacon", status: number) {
    const label = status === 0 ? "opaque" : String(status);
    super(`drand ${resource} request redirected (${label})`);
    this.status = status;
    this.resource = resource;
  }

  /** Build an error from a redirect response without echoing Location. */
  static fromResponse(resource: "chain-info" | "beacon", res: Response): DrandRedirectError {
    const status = res.type === "opaqueredirect" && res.status === 0 ? 0 : res.status;
    return new DrandRedirectError(resource, status);
  }
}

type FetchImpl = typeof fetch;

async function fetchDrand(
  url: string,
  resource: "chain-info" | "beacon",
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<Response> {
  // Never follow redirects: trust only the configured endpoint, not an
  // intermediary-selected Location destination.
  // `fetchWithTimeout` bounds the connection, the headers and the body read.
  const res = await fetchWithTimeout(url, { redirect: "manual" }, { fetchImpl });
  if (res.type === "opaqueredirect" || isHttpRedirectStatus(res.status)) {
    await res.body?.cancel();
    throw DrandRedirectError.fromResponse(resource, res);
  }
  return res;
}

export async function getChainInfo(fetchImpl?: FetchImpl): Promise<ChainInfo> {
  const res = await fetchDrand(`${API}/${QUICKNET_HASH}/info`, "chain-info", fetchImpl);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`info HTTP ${res.status}`);
  }
  return (await res.json()) as ChainInfo;
}

export async function getBeacon(
  round: number | "latest",
  fetchImpl?: FetchImpl,
): Promise<Beacon> {
  const res = await fetchDrand(
    `${API}/${QUICKNET_HASH}/public/${round}`,
    "beacon",
    fetchImpl,
  );
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`beacon ${round} HTTP ${res.status}`);
  }
  return (await res.json()) as Beacon;
}

export function roundAt(info: ChainInfo, unixSeconds: number): number {
  if (unixSeconds < info.genesis_time) return 1;
  return Math.floor((unixSeconds - info.genesis_time) / info.period) + 1;
}

/// Wall-clock time (unix seconds) at which Drand round `round` is published.
/// Throws for a zero/unsafe round or an intermediate value that overflows the
/// safe-integer range: the chain can never publish such a round, so callers
/// must reject it before committing any seal or locking escrow (issue #376).
export function timeOfRound(info: ChainInfo, round: number): number {
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new RangeError(`round must be a positive safe integer, got ${round}`);
  }
  if (!Number.isSafeInteger(info.period) || info.period <= 0) {
    throw new RangeError(`period must be a positive safe integer, got ${info.period}`);
  }
  const offsetSeconds = info.period * round;
  const publishAtSeconds = info.genesis_time + offsetSeconds;
  if (!Number.isSafeInteger(offsetSeconds) || !Number.isSafeInteger(publishAtSeconds)) {
    throw new RangeError(`round ${round} publish time overflows the safe-integer range`);
  }
  return publishAtSeconds;
}
