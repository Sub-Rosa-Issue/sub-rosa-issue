// Copyright (c) 2026 Sub Rosa contributors
// Soroban BLS12-381 serialization helpers.
//
// Soroban host functions expect *uncompressed, big-endian* points:
//   G1Affine = x(48) ‖ y(48)
//   G2Affine = x.c0(48) ‖ x.c1(48) ‖ y.c0(48) ‖ y.c1(48)
//
// @noble/curves stores Fp2 as { c0, c1 } bigints, so we assemble the bytes from
// affine coordinates explicitly rather than relying on the library's own byte
// order. We also emit the swapped (c1,c0) ordering so the on-chain test can
// confirm which ordering the host expects, with no guessing left in source.

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

type G1 = InstanceType<typeof bls.G1.Point>;
type G2 = InstanceType<typeof bls.G2.Point>;

function be48(x: bigint): Uint8Array {
  const b = new Uint8Array(48);
  for (let i = 47; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function encodeG1(point: G1): Uint8Array {
  const { x, y } = point.toAffine();
  return concat(be48(x), be48(y));
}

export type Fp2Order = "c0c1" | "c1c0";

// Soroban expects Fp2 as (c1, c0) — confirmed on-chain via the contract's BLS
// test (the (c0, c1) ordering is rejected as "point not on curve").
export function encodeG2(point: G2, order: Fp2Order = "c1c0"): Uint8Array {
  const { x, y } = point.toAffine() as unknown as {
    x: { c0: bigint; c1: bigint };
    y: { c0: bigint; c1: bigint };
  };
  return order === "c0c1"
    ? concat(be48(x.c0), be48(x.c1), be48(y.c0), be48(y.c1))
    : concat(be48(x.c1), be48(x.c0), be48(y.c1), be48(y.c0));
}

export function negatedG2Generator(order: Fp2Order = "c1c0"): Uint8Array {
  const negGen = bls.G2.Point.BASE.negate();
  return encodeG2(negGen, order);
}

export function pubkeyToSoroban(pkHexCompressed: string, order: Fp2Order = "c1c0"): Uint8Array {
  const pk = bls.G2.Point.fromHex(pkHexCompressed);
  return encodeG2(pk, order);
}
