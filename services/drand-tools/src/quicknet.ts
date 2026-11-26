// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export const DEFAULT_DRAND_API_URL = "https://api.drand.sh";

export interface DrandEndpointOptions {
  /** Allow plaintext HTTP to a loopback host (local development only). */
  allowLocalHttp?: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".localhost")) return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Validate a Drand API endpoint before anything is fetched from it.
 *
 * The beacon decides when a sealed bid opens, so a plaintext endpoint lets a
 * network attacker withhold or substitute the round and break the protocol's
 * timing guarantee. HTTPS is required for every remote host; `http://` is only
 * accepted for loopback hosts and only with an explicit `allowLocalHttp`.
 */
export function assertDrandEndpointUrl(
  rawUrl: string = DEFAULT_DRAND_API_URL,
  options: DrandEndpointOptions = {},
): URL {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    throw new Error("DRAND_API_URL must be a non-empty http(s) URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`DRAND_API_URL must be a valid http(s) URL, got ${JSON.stringify(rawUrl)}`);
  }
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol !== "http:") {
    throw new Error("DRAND_API_URL must use https:// (or http:// for local development)");
  }
  if (!options.allowLocalHttp || !isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      "DRAND_API_URL must use https://; plaintext Drand endpoints let a network " +
        "attacker withhold or substitute round signatures. Local development may " +
        "opt in with DRAND_ALLOW_LOCAL_HTTP=true against a loopback host.",
    );
  }
  return parsed;
}

/** The validated Drand API base URL, without a trailing slash. */
export function drandApiUrl(): string {
  const url = assertDrandEndpointUrl(process.env.DRAND_API_URL ?? DEFAULT_DRAND_API_URL, {
    allowLocalHttp: process.env.DRAND_ALLOW_LOCAL_HTTP === "true",
  });
  return url.toString().replace(/\/+$/, "");
}

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

export async function getChainInfo(): Promise<ChainInfo> {
  const res = await fetch(`${drandApiUrl()}/${QUICKNET_HASH}/info`);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  return (await res.json()) as ChainInfo;
}

export async function getBeacon(round: number | "latest"): Promise<Beacon> {
  const res = await fetch(`${drandApiUrl()}/${QUICKNET_HASH}/public/${round}`);
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
