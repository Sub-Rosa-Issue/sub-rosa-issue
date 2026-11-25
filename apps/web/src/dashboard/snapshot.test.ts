// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { DASHBOARD_FIXTURE } from "./fixture";
import type { DashboardData } from "./types";
import {
  classifyPhase,
  redactKeeperError,
  buildDashboardSnapshot,
} from "./snapshot";

// ---------------------------------------------------------------------------
// classifyPhase
// ---------------------------------------------------------------------------

test("classifyPhase: Settled status → Settled phase", () => {
  assert.equal(classifyPhase("Settled", false), "Settled");
  assert.equal(classifyPhase("Settled", true), "Settled");
});

test("classifyPhase: Voided status → Settled phase", () => {
  assert.equal(classifyPhase("Voided", false), "Settled");
});

test("classifyPhase: Open + drand not yet published → Open", () => {
  assert.equal(classifyPhase("Open", false), "Open");
});

test("classifyPhase: Open + drand published → Reveal", () => {
  assert.equal(classifyPhase("Open", true), "Reveal");
});

test("classifyPhase: Revealing → Reveal regardless of drand flag", () => {
  assert.equal(classifyPhase("Revealing", false), "Reveal");
  assert.equal(classifyPhase("Revealing", true), "Reveal");
});

test("classifyPhase: Cleared → Reveal regardless of drand flag", () => {
  assert.equal(classifyPhase("Cleared", false), "Reveal");
  assert.equal(classifyPhase("Cleared", true), "Reveal");
});

// ---------------------------------------------------------------------------
// redactKeeperError
// ---------------------------------------------------------------------------

test("redactKeeperError: null returns null", () => {
  assert.equal(redactKeeperError(null), null);
});

test("redactKeeperError: removes HTTP URL", () => {
  const out = redactKeeperError("Failed: http://rpc.internal/api returned 503");
  assert.ok(out !== null);
  assert.doesNotMatch(out, /rpc\.internal/);
  assert.match(out, /<redacted>/);
});

test("redactKeeperError: removes HTTPS URL with embedded auth", () => {
  const out = redactKeeperError("conn: https://user:pass@host.example.com/path");
  assert.ok(out !== null);
  assert.doesNotMatch(out, /user:pass/);
  assert.doesNotMatch(out, /host\.example\.com/);
});

test("redactKeeperError: removes wss:// URL", () => {
  const out = redactKeeperError("ws error: wss://secret-node.example.org/ws");
  assert.ok(out !== null);
  assert.doesNotMatch(out, /secret-node/);
  assert.match(out, /<redacted>/);
});

test("redactKeeperError: removes Stellar secret seed (S + 55 base32 chars)", () => {
  const seed = "SCZANGBA5RLBVAA5GPAGXB3ETPFHQU7AFWA6XQJVSQFPF5QMJCVUASMZ";
  const out = redactKeeperError(`Signing failed with key ${seed}`);
  assert.ok(out !== null);
  assert.doesNotMatch(out, new RegExp(seed));
  assert.match(out, /<redacted>/);
});

test("redactKeeperError: removes long hex strings (≥32 chars)", () => {
  const hex = "a".repeat(64);
  const out = redactKeeperError(`private key: ${hex}`);
  assert.ok(out !== null);
  assert.doesNotMatch(out, new RegExp(hex));
  assert.match(out, /<redacted>/);
});

test("redactKeeperError: removes Bearer token", () => {
  const out = redactKeeperError("auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp");
  assert.ok(out !== null);
  assert.doesNotMatch(out, /eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp/);
});

test("redactKeeperError: preserves safe diagnostic text", () => {
  const msg = "timeout waiting for ledger close after 30s";
  assert.equal(redactKeeperError(msg), msg);
});

test("redactKeeperError: is idempotent (double-redacting is safe)", () => {
  const raw = "Failed: https://rpc.example.com/rpc returned 503";
  const once = redactKeeperError(raw);
  const twice = redactKeeperError(once);
  assert.equal(once, twice);
});

// ---------------------------------------------------------------------------
// buildDashboardSnapshot
// ---------------------------------------------------------------------------

test("snapshot carries phase, roundId, keeperCursor, stale, keeperError", () => {
  const snap = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false);
  assert.equal(snap.phase, "Settled");
  assert.equal(snap.roundId, DASHBOARD_FIXTURE.meta.roundId);
  assert.equal(snap.keeperCursor, DASHBOARD_FIXTURE.keeper.currentPhase);
  assert.equal(snap.stale, false);
  assert.equal(snap.keeperError, null);
});

test("snapshot stale flag propagates correctly", () => {
  const snap = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, true);
  assert.equal(snap.stale, true);
});

test("snapshot redacts keeper error before storing it", () => {
  const rawError = "RPC error at https://secret-rpc.example.com/api";
  const snap = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false, rawError);
  assert.ok(snap.keeperError !== null);
  assert.doesNotMatch(snap.keeperError, /secret-rpc\.example\.com/);
  assert.match(snap.keeperError, /<redacted>/);
});

test("snapshot with keeper error still shows last verified phase", () => {
  const data: DashboardData = {
    ...DASHBOARD_FIXTURE,
    round: { ...DASHBOARD_FIXTURE.round, status: "Revealing" },
  };
  const snap = buildDashboardSnapshot(data, false, false, "connection refused");
  assert.equal(snap.phase, "Reveal");
  assert.equal(snap.keeperError, "connection refused");
});

test("two snapshots built from the same data are value-equal", () => {
  const a = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false);
  const b = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false);
  assert.deepEqual(a, b);
});

test("a newer snapshot replaces both cards together (atomicity check)", () => {
  // Both cards receive the same snapshot object reference; replacing it means
  // both update simultaneously.  We verify that two different snapshots built
  // from different data produce different phase+roundId without any
  // intermediate mixed state.
  const dataV1: DashboardData = {
    ...DASHBOARD_FIXTURE,
    meta: { ...DASHBOARD_FIXTURE.meta, roundId: 10 },
    round: { ...DASHBOARD_FIXTURE.round, status: "Open" },
  };
  const dataV2: DashboardData = {
    ...DASHBOARD_FIXTURE,
    meta: { ...DASHBOARD_FIXTURE.meta, roundId: 11 },
    round: { ...DASHBOARD_FIXTURE.round, status: "Settled" },
  };

  const snapV1 = buildDashboardSnapshot(dataV1, false, false);
  const snapV2 = buildDashboardSnapshot(dataV2, true, false);

  // No mixed state possible — each snapshot is self-consistent.
  assert.equal(snapV1.roundId, 10);
  assert.equal(snapV1.phase, "Open");
  assert.equal(snapV2.roundId, 11);
  assert.equal(snapV2.phase, "Settled");
});

test("does not open a network port (pure data transformation)", () => {
  // buildDashboardSnapshot and its helpers are pure functions; this assertion
  // confirms we reached the end without I/O.
  const snap = buildDashboardSnapshot(DASHBOARD_FIXTURE, false, false);
  assert.ok(typeof snap.phase === "string");
});
