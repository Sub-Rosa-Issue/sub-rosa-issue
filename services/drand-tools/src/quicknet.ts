// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

import { fetchWithTimeout } from "@sub-rosa/time";

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export const DRAND_CHAIN_HASH_ENV = "DRAND_CHAIN_HASH";
export const DRAND_API_URL_ENV = "DRAND_API_URL";
export const DEFAULT_DRAND_API_URL = "https://api.drand.sh";
export const CHAIN_HASH_REQUIRED_ERROR = "DRAND_CHAIN_HASH is required";
export const CHAIN_HASH_INVALID_ERROR = "DRAND_CHAIN_HASH must be a 64-character hex string";
export const CHAIN_HASH_MISMATCH_ERROR = "drand chain hash mismatch";

export interface DrandConfig {
  apiUrl: string;
  expectedChainHash: string;
  allowLocalHttp?: boolean;
}

export class DrandChainHashMismatchError extends Error {
  readonly code = "DRAND_CHAIN_HASH_MISMATCH";
  constructor() {
    super(CHAIN_HASH_MISMATCH_ERROR);
    this.name = "DrandChainHashMismatchError";
  }
}

export function assertDrandEndpointUrl(
  rawUrl = DEFAULT_DRAND_API_URL,
  options: { allowLocalHttp?: boolean } = {},
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid DRAND_API_URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DRAND_API_URL must not contain credentials, a query, or a fragment");
  }
  if (url.protocol === "https:") return url;
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol === "http:" && loopback && options.allowLocalHttp) return url;
  throw new Error("DRAND_API_URL requires HTTPS unless loopback HTTP is explicitly enabled");
}

function checkedDrandConfig(config: DrandConfig): DrandConfig {
  const expectedChainHash = config.expectedChainHash.trim().toLowerCase();
  if (!expectedChainHash) throw new Error(CHAIN_HASH_REQUIRED_ERROR);
  if (!/^[0-9a-f]{64}$/.test(expectedChainHash)) throw new Error(CHAIN_HASH_INVALID_ERROR);

  const url = assertDrandEndpointUrl(config.apiUrl, { allowLocalHttp: config.allowLocalHttp });
  return {
    apiUrl: url.href.replace(/\/+$/, ""),
    expectedChainHash,
    ...(config.allowLocalHttp ? { allowLocalHttp: true } : {}),
  };
}

export function loadDrandConfig(
  env: Record<string, string | undefined> = process.env,
): DrandConfig {
  return checkedDrandConfig({
    apiUrl: env[DRAND_API_URL_ENV]?.trim() || DEFAULT_DRAND_API_URL,
    expectedChainHash: env[DRAND_CHAIN_HASH_ENV] ?? "",
    allowLocalHttp: env.DRAND_ALLOW_LOCAL_HTTP?.trim().toLowerCase() === "true",
  });
}

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
  const res = await fetchWithTimeout(url, { redirect: "manual" }, { fetchImpl });
  if (res.type === "opaqueredirect" || isHttpRedirectStatus(res.status)) {
    throw DrandRedirectError.fromResponse(resource, res);
  }
  return res;
}

export async function getChainInfo(
  fetchImpl?: FetchImpl,
  config: DrandConfig = loadDrandConfig(),
): Promise<ChainInfo> {
  const { apiUrl, expectedChainHash } = checkedDrandConfig(config);
  const res = await fetchDrand(`${apiUrl}/${expectedChainHash}/info`, "chain-info", fetchImpl);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  const info = (await res.json()) as ChainInfo;
  if (typeof info?.hash !== "string" || info.hash.trim().toLowerCase() !== expectedChainHash) {
    throw new DrandChainHashMismatchError();
  }
  return info;
}

export async function getBeacon(
  round: number | "latest",
  fetchImpl?: FetchImpl,
  config: DrandConfig = loadDrandConfig(),
): Promise<Beacon> {
  const checked = checkedDrandConfig(config);
  await getChainInfo(fetchImpl, checked);
  const res = await fetchDrand(
    `${checked.apiUrl}/${checked.expectedChainHash}/public/${round}`,
    "beacon",
    fetchImpl,
  );
  if (!res.ok) throw new Error(`beacon ${round} HTTP ${res.status}`);
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
