// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

import {
  drandSignatureToSoroban,
  encodeG1Soroban,
  fetchRoundSignature,
  quicknet,
} from "./index.js";

// The exact round + uncompressed G1 signature the Round contract verifies
// on-chain in its frozen-vector BLS test (services/drand-tools captured it).
const VEC_ROUND = 29_155_653;
const VEC_SIG_G1 =
  "0f74ee9ea1bc8ab52cc375ec82e70b6fed483a2618e90eeaef5631555733554f8bb3ec7c8563341af525d09b3702cae7181d281dbcb68e4779e93184eea8f879301f980708c26e488b5417f9c257b6b9cee7f9a2d6981fb65b7bcd6bcc15d3ac";

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("encodeG1Soroban reproduces the on-chain-verified uncompressed bytes", () => {
  const p = bls.G1.Point.fromHex(VEC_SIG_G1);
  assert.equal(toHex(encodeG1Soroban(p)), VEC_SIG_G1);
});

test("live: quicknet round R signature decompresses to the frozen on-chain vector", async () => {
  // Pulls the *compressed* signature from the live Drand API and proves
  // drandSignatureToSoroban yields the precise 96-byte input open_reveal needs.
  const sig = await fetchRoundSignature(quicknet(), VEC_ROUND);
  assert.equal(toHex(sig), VEC_SIG_G1);
});
