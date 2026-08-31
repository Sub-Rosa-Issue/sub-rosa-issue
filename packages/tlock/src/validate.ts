// Copyright (c) 2026 Sub Rosa contributors
// Validation for the Drand quicknet HTTP response shapes — chain-info and
// per-round beacons — *before* any cryptographic code touches them.
//
// Drand endpoints return JSON that is not structurally guaranteed. If a proxy
// or replica serves a malformed body, downstream crypto (`drandRoundAt`,
// `drandSignatureToSoroban`, the keeper's round-wait math) would fail with a
// cryptic error or, worse, compute against garbage. These guards reject a bad
// response up-front with an explicit, actionable message.

import { isValidHex } from "./commitment.js";

/** Bound the range of sane values for a quicknet-scale chain. */
const MIN_PERIOD = 1;
const MAX_PERIOD = 1000;
const MIN_GENESIS_TIME = 1_000_000_000; // after Sept 2001
const MAX_GENESIS_TIME = 2_100_000_000; // before 2036
const CHAIN_HASH_HEX_LEN = 64; // SHA-256 digest

export interface RawChainInfo {
  public_key?: unknown;
  period?: unknown;
  genesis_time?: unknown;
  hash?: unknown;
  groupHash?: unknown;
  schemeID?: unknown;
  metadata?: { beaconID?: unknown };
}

export interface RawBeacon {
  round?: unknown;
  randomness?: unknown;
  signature?: unknown;
}

function fail(field: string, detail: string): never {
  throw new Error(`malformed drand chain-info: ${field} ${detail}`);
}

function beaconFail(field: string, detail: string): never {
  throw new Error(`malformed drand beacon: ${field} ${detail}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Validate a Drand chain-info object. Throws a descriptive {@link Error} when a
 * required field is missing or a numeric field falls outside its sane range.
 * Returns `void` (the object itself is trusted) on success.
 */
export function assertChainInfo(info: unknown): void {
  if (!info || typeof info !== "object") {
    throw new Error("malformed drand chain-info: expected an object");
  }
  const c = info as RawChainInfo;

  if (!isNonEmptyString(c.public_key) || !isValidHex(c.public_key)) {
    fail("public_key", "must be a non-empty hex string");
  }

  if (!isSafeNumber(c.period) || c.period < MIN_PERIOD || c.period > MAX_PERIOD) {
    fail(
      "period",
      `must be an integer in [${MIN_PERIOD}, ${MAX_PERIOD}] seconds, got ${String(c.period)}`,
    );
  }

  if (
    !isSafeNumber(c.genesis_time) ||
    c.genesis_time < MIN_GENESIS_TIME ||
    c.genesis_time > MAX_GENESIS_TIME
  ) {
    fail(
      "genesis_time",
      `must be an integer in [${MIN_GENESIS_TIME}, ${MAX_GENESIS_TIME}] (unix seconds), got ${String(c.genesis_time)}`,
    );
  }

  if (
    !isNonEmptyString(c.hash) ||
    !isValidHex(c.hash) ||
    c.hash.length !== CHAIN_HASH_HEX_LEN
  ) {
    fail(
      "hash",
      `must be a ${CHAIN_HASH_HEX_LEN}-char hex string (SHA-256 digest)`,
    );
  }

  if (!isNonEmptyString(c.groupHash) || !isValidHex(c.groupHash)) {
    fail("groupHash", "must be a non-empty hex string");
  }

  if (!isNonEmptyString(c.schemeID)) {
    fail("schemeID", "must be a non-empty string");
  }

  if (!c.metadata || typeof c.metadata !== "object") {
    fail("metadata.beaconID", "metadata must be present");
  }
  if (!isNonEmptyString(c.metadata?.beaconID)) {
    fail("metadata.beaconID", "must be a non-empty string");
  }
}

/**
 * Validate a Drand beacon (round randomness) object. Throws a descriptive
 * {@link Error} when a required field is missing or malformed. Returns `void`
 * on success. The caller is still responsible for rejecting beacons for rounds
 * that have not been published yet.
 */
export function assertBeacon(beacon: unknown): void {
  if (!beacon || typeof beacon !== "object") {
    throw new Error("malformed drand beacon: expected an object");
  }
  const b = beacon as RawBeacon;

  if (!isSafeNumber(b.round) || b.round <= 0) {
    beaconFail("round", `must be a positive integer, got ${String(b.round)}`);
  }

  if (!isNonEmptyString(b.randomness) || !isValidHex(b.randomness)) {
    beaconFail("randomness", "must be a non-empty hex string");
  }

  if (!isNonEmptyString(b.signature) || !isValidHex(b.signature)) {
    beaconFail("signature", "must be a non-empty hex string");
  }
}
