import { test } from "node:test";
import assert from "node:assert/strict";

import { QUICKNET_HASH } from "./quicknet.js";
import { classifyDrandRound } from "./freshness.js";

const QUICKNET_FIXTURE = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: {
    beaconID: "quicknet",
  },
};

test("QUICKNET_HASH matches the frozen quicknet fixture", () => {
  assert.equal(QUICKNET_HASH, QUICKNET_FIXTURE.hash);
});

test("required chain info fields are present in the fixture", () => {
  const info = QUICKNET_FIXTURE;

  assert.equal(typeof info.hash, "string");
  assert.ok(info.hash.length > 0, "hash is non-empty");

  assert.equal(typeof info.public_key, "string");
  assert.ok(info.public_key.length > 0, "public_key is non-empty");

  assert.equal(typeof info.period, "number");
  assert.ok(info.period > 0, "period is positive");

  assert.equal(typeof info.genesis_time, "number");
  assert.ok(info.genesis_time > 0, "genesis_time is positive");

  assert.equal(typeof info.schemeID, "string");
  assert.ok(info.schemeID.length > 0, "schemeID is non-empty");

  assert.equal(typeof info.groupHash, "string");
  assert.ok(info.groupHash.length > 0, "groupHash is non-empty");

  assert.equal(typeof info.metadata?.beaconID, "string");
  assert.ok(info.metadata.beaconID.length > 0, "beaconID is non-empty");
});

test("quicknet chain hash is 64 hex chars (SHA-256 output)", () => {
  assert.match(QUICKNET_FIXTURE.hash, /^[0-9a-f]{64}$/);
});

test("quicknet public key is a non-empty hex string (uncompressed G1)", () => {
  assert.match(QUICKNET_FIXTURE.public_key, /^[0-9a-f]+$/);
  assert.ok(QUICKNET_FIXTURE.public_key.length > 0);
});

test("quicknet period is 3 seconds", () => {
  assert.equal(QUICKNET_FIXTURE.period, 3);
});

test("quicknet scheme is bls-unchained-g1-rfc9380", () => {
  assert.equal(QUICKNET_FIXTURE.schemeID, "bls-unchained-g1-rfc9380");
});

test("quicknet beacon ID is quicknet", () => {
  assert.equal(QUICKNET_FIXTURE.metadata.beaconID, "quicknet");
});

test("quicknet genesis_time is in a reasonable range", () => {
  const gt = QUICKNET_FIXTURE.genesis_time;
  assert.ok(gt >= 1_600_000_000, "genesis_time is after year 2020");
  assert.ok(gt <= 2_000_000_000, "genesis_time is before year 2033");
});

test("freshness helper uses fixture fields to compute round timing", () => {
  const { genesis_time, period } = QUICKNET_FIXTURE;
  const round = 10_000_000;
  const publishAtS = genesis_time + period * round;
  const publishAtMs = publishAtS * 1000;

  const before = classifyDrandRound(round, { genesis_time, period }, publishAtMs - 1);
  assert.equal(before.status, "future");
  assert.equal(before.publishAtMs, publishAtMs);

  const at = classifyDrandRound(round, { genesis_time, period }, publishAtMs);
  assert.equal(at.status, "fresh");

  const after = classifyDrandRound(round, { genesis_time, period }, publishAtMs + 60_001);
  assert.equal(after.status, "stale");
  assert.ok(after.ageMs! >= 60_001);
});
