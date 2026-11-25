// Copyright (c) 2026 Sub Rosa contributors
// Drand quicknet client — the same network the Round contract verifies on-chain
// (chain hash 52db9ba7…, bls-unchained-g1-rfc9380, 3s rounds).

import {
  fetchBeacon,
  quicknetClient,
  roundAt as drandRoundAt,
} from "drand-client";

import { drandSignatureToSoroban, verifyDrandSignature } from "./bls.js";
import { assertBeacon, assertChainInfo } from "./validate.js";
import { systemClock, type Clock } from "@sub-rosa/time";

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
export const QUICKNET_GENESIS = 1_692_803_367;
export const QUICKNET_PERIOD = 3;

export const QUICKNET_FIXTURE = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: QUICKNET_PERIOD,
  genesis_time: QUICKNET_GENESIS,
  hash: QUICKNET_HASH,
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: {
    beaconID: "quicknet",
  },
} as const;

export function assertQuicknetFixture(info: {
  period?: unknown;
  genesis_time?: unknown;
  hash?: unknown;
}): void {
  if (info.period !== QUICKNET_FIXTURE.period) {
    throw new Error(
      `period mismatch: expected ${QUICKNET_FIXTURE.period}, got ${String(info.period)}`,
    );
  }
  if (info.genesis_time !== QUICKNET_FIXTURE.genesis_time) {
    throw new Error(
      `genesis_time mismatch: expected ${QUICKNET_FIXTURE.genesis_time}, got ${String(info.genesis_time)}`,
    );
  }
}

export type DrandClient = ReturnType<typeof quicknetClient>;

export function quicknet(): DrandClient {
  return quicknetClient();
}

export async function chainInfo(client: DrandClient) {
  const info = await client.chain().info();
  assertChainInfo(info);
  return info;
}

/// The round number live at `unixMillis` (defaults to now).
export async function currentRound(
  client: DrandClient,
  unixMillis: number = systemClock.nowMs(),
): Promise<number> {
  const info = await chainInfo(client);
  return drandRoundAt(unixMillis, info);
}

/// A round number that will be published roughly `seconds` from now — used to
/// seal a bid until a moment in the near future.
export async function roundInSeconds(
  client: DrandClient,
  seconds: number,
  clock: Clock = systemClock,
): Promise<number> {
  const info = await chainInfo(client);
  return drandRoundAt(clock.nowMs() + seconds * 1000, info);
}

/// The raw beacon (round, randomness, signature hex) for a specific round.
/// Rejects if round R has not yet been published, is for the wrong round,
/// or fails local BLS cryptographic verification.
export async function fetchRoundBeacon(client: DrandClient, round: number) {
  const beacon = await fetchBeacon(client, round);
  assertBeacon(beacon);

  // 1. Structural binding: Ensure the network didn't return a different round
  if (beacon.round !== round) {
    throw new Error(`Drand round mismatch: requested ${round}, received ${beacon.round}`);
  }

  // 2. Cryptographic binding: Verify the signature locally before trusting it
  const info = await chainInfo(client);
  const isValid = verifyDrandSignature(beacon.signature, round, info.public_key);
  
  if (!isValid) {
    throw new Error(`Invalid Drand signature for round ${round}`);
  }

  return beacon;
}

/// Round R's threshold signature, encoded as the 96-byte uncompressed G1 the
/// Round contract verifies on-chain. This is exactly the value `open_reveal`
/// takes. Rejects if R has not been published yet or the response is malformed.
export async function fetchRoundSignature(
  client: DrandClient,
  round: number,
): Promise<Uint8Array> {
  const beacon = await fetchRoundBeacon(client, round);
  return drandSignatureToSoroban(beacon.signature);
}