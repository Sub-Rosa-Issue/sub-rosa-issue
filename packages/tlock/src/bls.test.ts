// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

import { encodeG1Soroban, verifyDrandSignature } from "./bls.js";

// Load the shared offline vector file dynamically
const vectorsPath = new URL("../../../services/drand-tools/src/drand_vectors.json", import.meta.url);
const vectors = JSON.parse(readFileSync(vectorsPath, "utf-8"));

// League of Entropy Quicknet G2 Public Key (compressed format for standard BLS verification)
const QUICKNET_PUBKEY =
  "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("encodeG1Soroban reproduces the on-chain-verified uncompressed bytes", () => {
  const p = bls.G1.Point.fromHex(vectors.sig_g1);
  assert.equal(toHex(encodeG1Soroban(p)), vectors.sig_g1);
});

test("Offline: Accepts a matching valid round and signature", () => {
  const isValid = verifyDrandSignature(vectors.sig_g1, vectors.round, QUICKNET_PUBKEY);
  assert.equal(isValid, true);
});

test("Offline: Rejects a valid signature if the round number is wrong", () => {
  const isValid = verifyDrandSignature(vectors.sig_g1, vectors.invalidWrongRound, QUICKNET_PUBKEY);
  assert.equal(isValid, false);
});

test("Offline: Rejects a truncated signature", () => {
  const isValid = verifyDrandSignature(vectors.invalidTruncatedSignature, vectors.round, QUICKNET_PUBKEY);
  assert.equal(isValid, false);
});

test("Offline: Rejects an empty signature", () => {
  const isValid = verifyDrandSignature(vectors.invalidEmptySignature, vectors.round, QUICKNET_PUBKEY);
  assert.equal(isValid, false);
});