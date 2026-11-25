import assert from "node:assert/strict";
import { test } from "node:test";

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  encodeG1,
  encodeG2,
  negatedG2Generator,
  pubkeyToSoroban,
  toHex,
} from "./encode.js";

const digest = (bytes: Uint8Array): string => toHex(sha256(bytes));

test("encodeG1 emits the frozen 96-byte Soroban representation", () => {
  const encoded = encodeG1(bls.G1.Point.BASE);

  assert.equal(encoded.length, 96);
  assert.equal(
    digest(encoded),
    "b1fbe330769a11acc36fc723335b0220323273e006f2b6fdb9db39ea82e7c183",
  );
});

test("encodeG2 freezes both 192-byte Fp2 orderings", () => {
  const c0c1 = encodeG2(bls.G2.Point.BASE, "c0c1");
  const c1c0 = encodeG2(bls.G2.Point.BASE, "c1c0");

  assert.equal(c0c1.length, 192);
  assert.equal(c1c0.length, 192);
  assert.notDeepEqual(c0c1, c1c0);
  assert.equal(
    digest(c0c1),
    "547f53c1288c939a559451dcb4d99da1bf3ef35224a5ee6c7a3dac1c2cef9c4a",
  );
  assert.equal(
    digest(c1c0),
    "5600a07e0e726945a5fa596861b4cff8d2ca1dcd26d5aeafeb0aceab2df5d70a",
  );
});

test("negatedG2Generator emits the frozen default ordering", () => {
  const encoded = negatedG2Generator();

  assert.equal(encoded.length, 192);
  assert.equal(
    digest(encoded),
    "ce9e0b435980779d3108a30bb3563c3ad1676b7f524a1b63504a3352dbd4de62",
  );
});

test("pubkeyToSoroban decodes a compressed key and rejects malformed input", () => {
  const compressed = bls.G2.Point.BASE.toHex();
  const encoded = pubkeyToSoroban(compressed);

  assert.deepEqual(encoded, encodeG2(bls.G2.Point.BASE));
  assert.throws(() => pubkeyToSoroban("not-a-public-key"));
  assert.throws(() => pubkeyToSoroban("00"));
});

test("toHex preserves leading zero bytes", () => {
  assert.equal(toHex(new Uint8Array([0x00, 0x01, 0xab, 0xff])), "0001abff");
});
