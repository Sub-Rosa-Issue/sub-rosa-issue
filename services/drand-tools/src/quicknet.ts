// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function resolveDrandApiUrl(
  rawUrl = process.env.DRAND_API_URL ?? "https://api.drand.sh",
  allowLocalHttp = process.env.DRAND_ALLOW_LOCAL_HTTP === "true",
): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("DRAND_API_URL must not contain credentials");
  }
  if (parsed.protocol === "https:") {
    return parsed.toString().replace(/\/+$/, "");
  }
  if (
    parsed.protocol === "http:" &&
    allowLocalHttp &&
    LOCAL_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    return parsed.toString().replace(/\/+$/, "");
  }
  throw new Error(
    "DRAND_API_URL must use https:// (or http://localhost / 127.0.0.1 with DRAND_ALLOW_LOCAL_HTTP=true)",
  );
}

const API = resolveDrandApiUrl();

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
  const res = await fetch(`${API}/${QUICKNET_HASH}/info`);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  return (await res.json()) as ChainInfo;
}

export async function getBeacon(round: number | "latest"): Promise<Beacon> {
  const res = await fetch(`${API}/${QUICKNET_HASH}/public/${round}`);
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
