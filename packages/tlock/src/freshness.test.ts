import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyDrandRound, DEFAULT_STALE_THRESHOLD_MS } from "./freshness.js";

test("freshness: missing or invalid round returns unknown", () => {
  const info = { genesis_time: 1677685200, period: 3 };
  const now = 1700000000000;

  assert.equal(classifyDrandRound(undefined, info, now).status, "unknown");
  assert.equal(classifyDrandRound(null, info, now).status, "unknown");
  assert.equal(classifyDrandRound(0, info, now).status, "unknown");
  assert.equal(classifyDrandRound(-5, info, now).status, "unknown");
  assert.equal(classifyDrandRound(1.5, info, now).status, "unknown");
});

test("freshness: malformed drand info returns unknown", () => {
  const now = 1700000000000;
  const round = 1000;

  assert.equal(classifyDrandRound(round, undefined, now).status, "unknown");
  assert.equal(classifyDrandRound(round, null, now).status, "unknown");
  assert.equal(classifyDrandRound(round, { genesis_time: -10, period: 3 }, now).status, "unknown");
  assert.equal(classifyDrandRound(round, { genesis_time: 1677685200, period: 0 }, now).status, "unknown");
  assert.equal(classifyDrandRound(round, { genesis_time: 1677685200, period: -3 }, now).status, "unknown");

  // @ts-expect-error Testing missing props at runtime
  assert.equal(classifyDrandRound(round, { genesis_time: 1677685200 }, now).status, "unknown");
});

test("freshness: invalid timestamp returns unknown", () => {
  const info = { genesis_time: 1677685200, period: 3 };
  assert.equal(classifyDrandRound(1000, info, -500).status, "unknown");
  assert.equal(classifyDrandRound(1000, info, 1.5).status, "unknown");
  // @ts-expect-error Testing invalid types
  assert.equal(classifyDrandRound(1000, info, "yesterday").status, "unknown");
});

test("freshness: future round", () => {
  const info = { genesis_time: 1000, period: 3 };
  const round = 10;
  // publishAtMs = (1000 + 3 * 10) * 1000 = 1030000

  const now = 1000000; // well before publish
  const res = classifyDrandRound(round, info, now);
  assert.equal(res.status, "future");
  assert.equal(res.publishAtMs, 1030000);
});

test("freshness: fresh round", () => {
  const info = { genesis_time: 1000, period: 3 };
  const round = 10;
  // publishAtMs = 1030000

  // Exactly at publish time
  assert.equal(classifyDrandRound(round, info, 1030000).status, "fresh");

  // Just under threshold
  assert.equal(classifyDrandRound(round, info, 1030000 + DEFAULT_STALE_THRESHOLD_MS).status, "fresh");

  // Custom threshold
  assert.equal(classifyDrandRound(round, info, 1030005, 10).status, "fresh");
});

test("freshness: stale round", () => {
  const info = { genesis_time: 1000, period: 3 };
  const round = 10;
  // publishAtMs = 1030000

  // Just over threshold
  const res = classifyDrandRound(round, info, 1030000 + DEFAULT_STALE_THRESHOLD_MS + 1);
  assert.equal(res.status, "stale");
  assert.equal(res.ageMs, DEFAULT_STALE_THRESHOLD_MS + 1);

  // Custom threshold stale
  assert.equal(classifyDrandRound(round, info, 1030011, 10).status, "stale");
});
