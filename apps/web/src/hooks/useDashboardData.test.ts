import assert from "node:assert/strict";
import { test } from "node:test";

import { isStale } from "./useDashboardData";

// Mirrors STALE_THRESHOLD_MS in useDashboardData.ts (5 minutes). Kept as a
// local constant rather than imported so these tests pin the *contract*
// (fresh below the threshold, stale above it) without depending on that
// value being exported.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const NOW_MS = Date.parse("2026-06-15T12:00:00.000Z");

test("invalid or missing timestamps are treated as stale", () => {
  assert.equal(isStale("not-a-date", NOW_MS), true, "unparseable string");
  assert.equal(isStale("", NOW_MS), true, "empty string");
  assert.equal(isStale("abcdef", NOW_MS), true, "garbage string");
  assert.equal(isStale("2026-13-45T00:00:00Z", NOW_MS), true, "invalid calendar date");
  assert.equal(isStale(null, NOW_MS), true, "null");
  assert.equal(isStale(undefined, NOW_MS), true, "undefined");
});

test("valid fresh timestamps are not stale", () => {
  const fetchedAt = new Date(NOW_MS - 30_000).toISOString(); // 30s ago
  assert.equal(isStale(fetchedAt, NOW_MS), false);
});

test("valid old timestamps beyond the threshold are stale", () => {
  const fetchedAt = new Date(NOW_MS - STALE_THRESHOLD_MS - 60_000).toISOString(); // 6 min ago
  assert.equal(isStale(fetchedAt, NOW_MS), true);
});

test("a timestamp equal to now is fresh", () => {
  const fetchedAt = new Date(NOW_MS).toISOString();
  assert.equal(isStale(fetchedAt, NOW_MS), false);
});

test("a future timestamp is fresh (unchanged pre-existing behavior)", () => {
  const fetchedAt = new Date(NOW_MS + 60_000).toISOString(); // 1 min in the future
  assert.equal(isStale(fetchedAt, NOW_MS), false);
});

test("boundary: exactly at the stale threshold is still fresh (strict greater-than)", () => {
  const fetchedAt = new Date(NOW_MS - STALE_THRESHOLD_MS).toISOString();
  assert.equal(isStale(fetchedAt, NOW_MS), false);
});

test("boundary: one millisecond past the stale threshold is stale", () => {
  const fetchedAt = new Date(NOW_MS - STALE_THRESHOLD_MS - 1).toISOString();
  assert.equal(isStale(fetchedAt, NOW_MS), true);
});

test("boundary: one millisecond inside the stale threshold is fresh", () => {
  const fetchedAt = new Date(NOW_MS - STALE_THRESHOLD_MS + 1).toISOString();
  assert.equal(isStale(fetchedAt, NOW_MS), false);
});
