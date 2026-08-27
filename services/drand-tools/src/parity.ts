// Copyright (c) 2026 Sub Rosa contributors
// Off-chain replica of the contract's BLS verification, run against a real
// quicknet beacon. This confirms the exact message construction and DST the
// on-chain `verify_round` must use — independent of point serialization.

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Drand "unchained" on G1 (bls-unchained-g1-rfc9380).
export const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

function beU64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export type MessageVariant = "sha256(be8)" | "be8";

export function roundMessage(round: number, variant: MessageVariant): Uint8Array {
  const be = beU64(round);
  return variant === "sha256(be8)" ? sha256(be) : be;
}

/// Verify e(H, pk) == e(sig, g2_generator) for a given message variant.
export function verifyBeacon(
  round: number,
  signatureHex: string,
  pubkeyHex: string,
  variant: MessageVariant,
): boolean {
  const msg = roundMessage(round, variant);
  const H = bls.G1.hashToCurve(msg, { DST }) as unknown as InstanceType<
    typeof bls.G1.Point
  >;
  const sig = bls.G1.Point.fromHex(signatureHex);
  const pk = bls.G2.Point.fromHex(pubkeyHex);

  const lhs = bls.pairing(H, pk);
  const rhs = bls.pairing(sig, bls.G2.Point.BASE);
  return bls.fields.Fp12.eql(lhs, rhs);
}

/// Try the known message constructions and return the one that verifies.
export function detectMessageVariant(
  round: number,
  signatureHex: string,
  pubkeyHex: string,
): MessageVariant | null {
  const variants: MessageVariant[] = ["sha256(be8)", "be8"];
  for (const v of variants) {
    try {
      if (verifyBeacon(round, signatureHex, pubkeyHex, v)) return v;
    } catch {
      // try next variant
    }
  }
  return null;
}
