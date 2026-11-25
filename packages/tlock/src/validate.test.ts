// Copyright (c) 2026 Sub Rosa contributors
// Focused unit tests for Drand quicknet response-shape validation. These are
// fully offline — no HTTP, no real Drand network. They exercise
// `assertChainInfo` / `assertBeacon` directly against valid and malformed
// fixtures, proving cryptographic consumers are guarded before use.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertBeacon, assertChainInfo } from "./validate.js";

const GOOD_CHAIN_INFO = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};

const GOOD_BEACON = {
  round: 29_155_653,
  randomness:
    "3e9f1c2c6ab0f7c0f9b0a44bbd14cf0a3d2b3a6b1e4f5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b10",
  signature:
    "8c8c0e1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f10",
};

function chainClone(mutate: (c: Record<string, unknown>) => void) {
  const clone = JSON.parse(JSON.stringify(GOOD_CHAIN_INFO)) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

function beaconClone(mutate: (c: Record<string, unknown>) => void) {
  const clone = JSON.parse(JSON.stringify(GOOD_BEACON)) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

test("assertChainInfo accepts a well-formed quicknet chain-info", () => {
  assert.doesNotThrow(() => assertChainInfo(GOOD_CHAIN_INFO));
});

test("assertChainInfo rejects a non-object", () => {
  assert.throws(() => assertChainInfo(undefined), /chain-info/);
  assert.throws(() => assertChainInfo(null), /chain-info/);
  assert.throws(() => assertChainInfo("nope"), /chain-info/);
});

test("assertChainInfo rejects a missing public_key", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.public_key)), /public_key/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.public_key = ""; })), /public_key/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.public_key = "not-hex!!"; })), /public_key/);
});

test("assertChainInfo rejects a non-positive or missing period", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.period)), /period/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.period = 0; })), /period/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.period = -3; })), /period/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.period = 1.5; })), /period/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.period = "3"; })), /period/);
});

test("assertChainInfo rejects an out-of-range period", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => { c.period = 1001; })), /period/);
});

test("assertChainInfo rejects a missing or out-of-range genesis_time", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.genesis_time)), /genesis_time/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.genesis_time = 0; })), /genesis_time/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.genesis_time = -1; })), /genesis_time/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.genesis_time = 1234; })), /genesis_time/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.genesis_time = 2_100_000_001; })), /genesis_time/);
});

test("assertChainInfo rejects a malformed chain hash", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.hash)), /hash/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.hash = "deadbeef"; })), /hash/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.hash = `${"a".repeat(63)}z`; })), /hash/);
});

test("assertChainInfo rejects a missing groupHash or schemeID", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.groupHash)), /groupHash/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.groupHash = "!!"; })), /groupHash/);
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.schemeID)), /schemeID/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.schemeID = ""; })), /schemeID/);
});

test("assertChainInfo rejects a missing metadata beaconID", () => {
  assert.throws(() => assertChainInfo(chainClone((c) => delete c.metadata)), /beaconID/);
  assert.throws(() =>
    assertChainInfo(chainClone((c) => { (c.metadata as { beaconID?: unknown }).beaconID = ""; })),
  /beaconID/);
  assert.throws(() => assertChainInfo(chainClone((c) => { c.metadata = { beaconID: "" }; })), /beaconID/);
});

test("assertBeacon accepts a well-formed beacon", () => {
  assert.doesNotThrow(() => assertBeacon(GOOD_BEACON));
});

test("assertBeacon rejects a non-object", () => {
  assert.throws(() => assertBeacon(undefined), /beacon/);
  assert.throws(() => assertBeacon(null), /beacon/);
  assert.throws(() => assertBeacon(42), /beacon/);
});

test("assertBeacon rejects a missing or non-positive round", () => {
  assert.throws(() => assertBeacon(beaconClone((c) => delete c.round)), /round/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.round = 0; })), /round/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.round = -1; })), /round/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.round = 1.5; })), /round/);
});

test("assertBeacon rejects a missing or non-hex randomness", () => {
  assert.throws(() => assertBeacon(beaconClone((c) => delete c.randomness)), /randomness/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.randomness = ""; })), /randomness/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.randomness = "zz"; })), /randomness/);
});

test("assertBeacon rejects a missing or non-hex signature (guards crypto)", () => {
  assert.throws(() => assertBeacon(beaconClone((c) => delete c.signature)), /signature/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.signature = ""; })), /signature/);
  assert.throws(() => assertBeacon(beaconClone((c) => { c.signature = "not-a-sig"; })), /signature/);
});
