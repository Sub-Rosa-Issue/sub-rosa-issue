// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import { QUICKNET_HASH, assertQuicknetFixture } from "./quicknet.js";
import { classifyDrandRound } from "./freshness.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(__dirname, "../../../test-vectors/quicknet.json");
const vectors = JSON.parse(fs.readFileSync(vectorPath, "utf-8"));
const QUICKNET_FIXTURE = vectors[0];

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

test("a mutated period fails the fixture comparison", () => {
  const mutated = { ...QUICKNET_FIXTURE, period: 4 };
  assert.throws(() => assertQuicknetFixture(mutated), /period mismatch/);
});
