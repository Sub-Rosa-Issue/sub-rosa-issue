// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

const API = process.env.DRAND_API_URL ?? "https://api.drand.sh";

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

/// The one stable category every "this did not come back as JSON" failure uses,
/// so callers can match on it instead of on message text.
export const NON_JSON_RESPONSE = "non-json-response";

export class DrandResponseError extends Error {
  readonly category = NON_JSON_RESPONSE;
  constructor(
    readonly endpoint: string,
    readonly contentType: string | null,
    detail: string,
  ) {
    super(`${endpoint} returned a non-JSON response (${detail})`);
    this.name = "DrandResponseError";
  }
}

/// `application/json`, optionally followed by parameters such as a charset.
const JSON_MEDIA_TYPE = /^application\/json\s*(;.*)?$/i;

/// Parse a success response as JSON, but only when the server says it is JSON.
/// An intermediary that answers 200 with an HTML error page would otherwise
/// surface as an opaque `Unexpected token '<'` parse error.
async function readJson<T>(res: Response, endpoint: string): Promise<T> {
  const contentType = res.headers.get("content-type");
  if (contentType === null || !JSON_MEDIA_TYPE.test(contentType.trim())) {
    throw new DrandResponseError(endpoint, contentType, `content-type ${contentType ?? "missing"}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new DrandResponseError(endpoint, contentType, "body is not valid JSON");
  }
}

export async function getChainInfo(): Promise<ChainInfo> {
  const res = await fetch(`${API}/${QUICKNET_HASH}/info`);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  return readJson<ChainInfo>(res, "info");
}

export async function getBeacon(round: number | "latest"): Promise<Beacon> {
  const res = await fetch(`${API}/${QUICKNET_HASH}/public/${round}`);
  if (!res.ok) throw new Error(`beacon ${round} HTTP ${res.status}`);
  return readJson<Beacon>(res, `beacon ${round}`);
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
