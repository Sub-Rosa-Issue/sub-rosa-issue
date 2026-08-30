// Copyright (c) 2026 Sub Rosa contributors
// Drand quicknet client — the same network the Round contract verifies on-chain
// (chain hash 52db9ba7…, bls-unchained-g1-rfc9380, 3s rounds).

import {
  fetchBeacon,
  quicknetClient,
  roundAt as drandRoundAt,
} from "drand-client";

import { drandSignatureToSoroban } from "./bls.js";
import { systemClock, type Clock } from "@sub-rosa/time";

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export type DrandClient = ReturnType<typeof quicknetClient>;

export function quicknet(): DrandClient {
  return quicknetClient();
}

export async function chainInfo(client: DrandClient) {
  return client.chain().info();
}

/// The round number live at `unixMillis` (defaults to now).
export async function currentRound(
  client: DrandClient,
  unixMillis: number = systemClock.nowMs(),
): Promise<number> {
  const info = await client.chain().info();
  return drandRoundAt(unixMillis, info);
}

/// A round number that will be published roughly `seconds` from now — used to
/// seal a bid until a moment in the near future.
export async function roundInSeconds(
  client: DrandClient,
  seconds: number,
  clock: Clock = systemClock,
): Promise<number> {
  const info = await client.chain().info();
  return drandRoundAt(clock.nowMs() + seconds * 1000, info);
}

/// The raw beacon (round, randomness, signature hex) for a specific round.
/// Rejects if round R has not yet been published.
export async function fetchRoundBeacon(client: DrandClient, round: number) {
  return fetchBeacon(client, round);
}

/// Round R's threshold signature, encoded as the 96-byte uncompressed G1 the
/// Round contract verifies on-chain. This is exactly the value `open_reveal`
/// takes. Rejects if R has not been published yet.
export async function fetchRoundSignature(
  client: DrandClient,
  round: number,
): Promise<Uint8Array> {
  const beacon = await fetchBeacon(client, round);
  return drandSignatureToSoroban(beacon.signature);
}
