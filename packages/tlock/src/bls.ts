// Copyright (c) 2026 Sub Rosa contributors
// Drand signature → Soroban G1 encoding.
//
// The Round contract verifies round R's threshold signature on-chain with
// Soroban's BLS12-381 host functions, which expect an *uncompressed, big-endian*
// G1 point: x(48) ‖ y(48) = 96 bytes. The Drand HTTP API returns the signature
// *compressed* (48-byte hex). This decompresses it into the exact 96-byte form
// the contract's `open_reveal` checks — the same encoding proven on-chain by the
// contract's frozen-vector BLS test. No guessing, no fallback.

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

type G1Point = InstanceType<typeof bls.G1.Point>;

function be48(x: bigint): Uint8Array {
  const b = new Uint8Array(48);
  for (let i = 47; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

/** Encode a G1 point as Soroban's uncompressed big-endian x(48)‖y(48). */
export function encodeG1Soroban(point: G1Point): Uint8Array {
  const { x, y } = point.toAffine();
  const out = new Uint8Array(96);
  out.set(be48(x), 0);
  out.set(be48(y), 48);
  return out;
}

/** Convert a Drand signature (compressed or uncompressed G1 hex) into the
 *  96-byte uncompressed form the Round contract verifies on-chain. */
export function drandSignatureToSoroban(signatureHex: string): Uint8Array {
  return encodeG1Soroban(bls.G1.Point.fromHex(signatureHex));
}
