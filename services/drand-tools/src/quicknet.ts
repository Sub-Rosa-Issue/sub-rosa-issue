// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export const DRAND_CHAIN_HASH_ENV = "DRAND_CHAIN_HASH";
export const DRAND_API_URL_ENV = "DRAND_API_URL";
export const DEFAULT_DRAND_API_URL = "https://api.drand.sh";
export const CHAIN_HASH_REQUIRED_ERROR = "DRAND_CHAIN_HASH is required";
export const CHAIN_HASH_INVALID_ERROR =
  "DRAND_CHAIN_HASH must be a 64-character hex string";
export const CHAIN_HASH_MISMATCH_ERROR = "drand chain hash mismatch";

export interface DrandConfig {
  apiUrl: string;
  expectedChainHash: string;
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

export class DrandChainHashMismatchError extends Error {
  readonly code = "DRAND_CHAIN_HASH_MISMATCH";

  constructor() {
    super(CHAIN_HASH_MISMATCH_ERROR);
    this.name = "DrandChainHashMismatchError";
  }
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase();
}

function isChainHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function loadDrandConfig(
  env: Record<string, string | undefined> = process.env,
): DrandConfig {
  const rawHash = env[DRAND_CHAIN_HASH_ENV];
  if (!rawHash || rawHash.trim() === "") {
    throw new Error(CHAIN_HASH_REQUIRED_ERROR);
  }
  const expectedChainHash = normalizeHash(rawHash);
  if (!isChainHash(expectedChainHash)) {
    throw new Error(CHAIN_HASH_INVALID_ERROR);
  }
  const apiUrl = env[DRAND_API_URL_ENV]?.trim() || DEFAULT_DRAND_API_URL;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    expectedChainHash,
  };
}

export function assertChainHashMatches(
  info: ChainInfo,
  expectedChainHash: string,
): void {
  const actual = typeof info?.hash === "string" ? normalizeHash(info.hash) : "";
  if (!isChainHash(actual) || actual !== normalizeHash(expectedChainHash)) {
    throw new DrandChainHashMismatchError();
  }
}

export async function getChainInfo(
  config: DrandConfig = loadDrandConfig(),
): Promise<ChainInfo> {
  const res = await fetch(`${config.apiUrl}/${config.expectedChainHash}/info`);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  const info = (await res.json()) as ChainInfo;
  assertChainHashMatches(info, config.expectedChainHash);
  return info;
}

export async function getBeacon(
  round: number | "latest",
  config: DrandConfig = loadDrandConfig(),
): Promise<Beacon> {
  const res = await fetch(
    `${config.apiUrl}/${config.expectedChainHash}/public/${round}`,
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
