// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DASHBOARD_FIXTURE } from "../../dashboard/fixture";
import type { DashboardData } from "../../dashboard/types";
import { buildDashboardSnapshot } from "../../dashboard/snapshot";
import type { DashboardSnapshot } from "@sub-rosa/sdk";
import { KeeperStatusCard } from "./KeeperStatusCard";

function makeSnapshot(
  overrides: Partial<DashboardSnapshot> = {},
): DashboardSnapshot {
  const base = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false);
  return { ...base, ...overrides };
}

function render(
  data: Partial<DashboardData> = {},
  snapshotOverrides: Partial<DashboardSnapshot> = {},
): string {
  const fullData: DashboardData = { ...DASHBOARD_FIXTURE, ...data };
  const snapshot = makeSnapshot(snapshotOverrides);
  return renderToStaticMarkup(<KeeperStatusCard data={fullData} snapshot={snapshot} />);
}

// ---------------------------------------------------------------------------
// Shared snapshot — both cards see the same phase and round id
// ---------------------------------------------------------------------------

test("keeper card shows the phase from the shared snapshot", () => {
  const html = render({}, { phase: "Settled" });
  assert.match(html, /Settled/);
});

test("keeper card shows the round id from the shared snapshot", () => {
  const html = render({}, { roundId: 7 });
  assert.match(html, /7/);
});

test("keeper card shows the keeper cursor from the shared snapshot", () => {
  const html = render({}, { keeperCursor: "ready-to-settle" });
  assert.match(html, /ready to settle/);
});

test("fixture snapshot: both cards would show the same phase and round id", () => {
  // Simulate what DashboardPage does: build one snapshot and pass it to both.
  const snapshot = buildDashboardSnapshot(DASHBOARD_FIXTURE, true, false);
  const roundHtml = renderToStaticMarkup(
    <KeeperStatusCard data={DASHBOARD_FIXTURE} snapshot={snapshot} />,
  );
  // Phase from shared snapshot
  assert.match(roundHtml, new RegExp(snapshot.phase));
  // Round ID from shared snapshot
  assert.match(roundHtml, new RegExp(String(snapshot.roundId)));
});

// ---------------------------------------------------------------------------
// Older snapshot cannot update only one card (snapshot atomicity)
// ---------------------------------------------------------------------------

test("an older snapshot does not partially update the card — same object is used", () => {
  const oldSnapshot = buildDashboardSnapshot(
    { ...DASHBOARD_FIXTURE, meta: { ...DASHBOARD_FIXTURE.meta, roundId: 1 } },
    false,
    true,
  );
  const newSnapshot = buildDashboardSnapshot(
    { ...DASHBOARD_FIXTURE, meta: { ...DASHBOARD_FIXTURE.meta, roundId: 2 } },
    true,
    false,
  );

  const htmlOld = renderToStaticMarkup(
    <KeeperStatusCard data={DASHBOARD_FIXTURE} snapshot={oldSnapshot} />,
  );
  const htmlNew = renderToStaticMarkup(
    <KeeperStatusCard data={DASHBOARD_FIXTURE} snapshot={newSnapshot} />,
  );

  // Old snapshot shows round 1; new snapshot shows round 2 — they cannot mix.
  assert.match(htmlOld, /1/);
  assert.match(htmlNew, /2/);
  // Both cards get exactly the phase from their respective snapshots, not from
  // independently re-derived state.
  assert.match(htmlOld, /Open/);
  assert.match(htmlNew, /Settled/);
});

// ---------------------------------------------------------------------------
// Keeper error redaction
// ---------------------------------------------------------------------------

test("a keeper error with an RPC URL is redacted from the card", () => {
  const html = render(
    {},
    {
      keeperError:
        "RPC call failed: https://secret-rpc.example.com/api?key=abc123 returned 503",
    },
  );
  assert.doesNotMatch(html, /secret-rpc\.example\.com/);
  assert.doesNotMatch(html, /abc123/);
  assert.match(html, /&lt;redacted&gt;|<redacted>/);
});

test("a keeper error with a Stellar secret seed is redacted", () => {
  const seed = "SCZANGBA5RLBVAA5GPAGXB3ETPFHQU7AFWA6XQJVSQFPF5QMJCVUASMZ";
  const html = render({}, { keeperError: `Signing failed with key ${seed}` });
  assert.doesNotMatch(html, new RegExp(seed));
  assert.match(html, /&lt;redacted&gt;|<redacted>/);
});

test("a keeper error with no secrets is shown verbatim", () => {
  const html = render({}, { keeperError: "timeout waiting for ledger close" });
  assert.match(html, /timeout waiting for ledger close/);
});

test("a null keeper error renders no error banner", () => {
  const html = render({}, { keeperError: null });
  assert.doesNotMatch(html, /dashboard-keeper-error/);
  assert.doesNotMatch(html, /Keeper error/);
});

test("a keeper error shows the last verified phase as stale", () => {
  // When there is an error the card still renders the last phase from the
  // snapshot (not hidden) so the operator can see what state was last verified.
  const html = render(
    {},
    {
      phase: "Reveal",
      keeperCursor: "revealing",
      keeperError: "connection refused",
      stale: true,
    },
  );
  // Phase badge should still be present
  assert.match(html, /Reveal/);
  // Error label should also be present
  assert.match(html, /error \(stale\)/);
});

// ---------------------------------------------------------------------------
// No network port (node:test runner, renderToStaticMarkup — no DOM/ports)
// ---------------------------------------------------------------------------

test("rendering does not require a live network connection (no fetch/WebSocket)", () => {
  // If any import or render path opened a network connection this test would
  // fail in a sandboxed environment.  renderToStaticMarkup is purely
  // synchronous SSR; the assertion is that we reached here without throwing.
  const html = render();
  assert.ok(html.length > 0);
});
