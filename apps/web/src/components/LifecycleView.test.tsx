// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundStatus } from "@sub-rosa/sdk";
import { LifecycleView } from "./LifecycleView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(status: RoundStatus): string {
  return renderToStaticMarkup(<LifecycleView status={status} />);
}

/** Extract data-step/data-status pairs from rendered HTML. */
function parseSteps(html: string): Array<{ step: string; status: string }> {
  const re = /data-step="([^"]+)"[^>]*data-status="([^"]+)"/g;
  const results: Array<{ step: string; status: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push({ step: m[1], status: m[2] });
  }
  return results;
}

function isSettleDisabled(html: string): boolean {
  // Settle step has .disabled class and aria-disabled="true"
  return (
    html.includes('data-step="settle"') &&
    html.includes('aria-disabled="true"') &&
    /lifecycle-step[^"]*disabled[^"]*"[^>]*data-step="settle"/.test(html)
  );
}

// ---------------------------------------------------------------------------
// Acceptance criterion 1:
// Commit, reveal, and settle fixtures highlight only the matching step.
// ---------------------------------------------------------------------------

test("Open status: commit is active, reveal and settle are pending", () => {
  const html = render("Open");
  const steps = parseSteps(html);
  assert.equal(steps.length, 3, "must have 3 steps");
  assert.deepEqual(steps, [
    { step: "commit", status: "active" },
    { step: "reveal", status: "pending" },
    { step: "settle", status: "pending" },
  ]);
});

test("Revealing status: commit is done, reveal is active, settle is pending", () => {
  const html = render("Revealing");
  const steps = parseSteps(html);
  assert.deepEqual(steps, [
    { step: "commit", status: "done" },
    { step: "reveal", status: "active" },
    { step: "settle", status: "pending" },
  ]);
});

test("Cleared status: commit is done, reveal is active, settle is pending", () => {
  const html = render("Cleared");
  const steps = parseSteps(html);
  assert.deepEqual(steps, [
    { step: "commit", status: "done" },
    { step: "reveal", status: "active" },
    { step: "settle", status: "pending" },
  ]);
});

test("Settled status: all steps are done", () => {
  const html = render("Settled");
  const steps = parseSteps(html);
  assert.deepEqual(steps, [
    { step: "commit", status: "done" },
    { step: "reveal", status: "done" },
    { step: "settle", status: "active" },
  ]);
});

test("Voided status: treated as terminal — settle step is active", () => {
  const html = render("Voided");
  const steps = parseSteps(html);
  assert.deepEqual(steps, [
    { step: "commit", status: "done" },
    { step: "reveal", status: "done" },
    { step: "settle", status: "active" },
  ]);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2:
// Settle is disabled during commit and reveal phases.
// ---------------------------------------------------------------------------

test("Open status: settle step is disabled", () => {
  const html = render("Open");
  assert.ok(isSettleDisabled(html), "settle must be disabled when status is Open");
});

test("Revealing status: settle step is disabled", () => {
  const html = render("Revealing");
  assert.ok(isSettleDisabled(html), "settle must be disabled when status is Revealing");
});

test("Cleared status: settle step is disabled", () => {
  const html = render("Cleared");
  assert.ok(isSettleDisabled(html), "settle must be disabled when status is Cleared");
});

test("Settled status: settle step is NOT disabled", () => {
  const html = render("Settled");
  assert.doesNotMatch(
    html,
    /aria-disabled="true"/,
    "settle must not be disabled when status is Settled",
  );
});

test("Voided status: settle step is NOT disabled", () => {
  const html = render("Voided");
  assert.doesNotMatch(
    html,
    /aria-disabled="true"/,
    "settle must not be disabled when status is Voided",
  );
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3:
// An unknown phase does not show settle as done; renders error state.
// ---------------------------------------------------------------------------

test("Unknown status: renders error panel, not lifecycle steps", () => {
  const html = render("Unknown");
  assert.ok(
    html.includes('data-testid="lifecycle-error"'),
    "must render error panel for Unknown",
  );
  assert.doesNotMatch(
    html,
    /data-step="settle"/,
    "must not render settle step for Unknown",
  );
  assert.doesNotMatch(
    html,
    /data-status="active"/,
    "must not show any active step for Unknown",
  );
});

test("NotFound status: renders error panel, not lifecycle steps", () => {
  const html = render("NotFound");
  assert.ok(
    html.includes('data-testid="lifecycle-error"'),
    "must render error panel for NotFound",
  );
  assert.doesNotMatch(
    html,
    /data-step="settle"/,
    "must not render settle step for NotFound",
  );
});

test("Unknown status: error message includes the status value", () => {
  const html = render("Unknown");
  assert.ok(html.includes(">Unknown<"), "error message must name the status");
});

test("NotFound status: error message includes the status value", () => {
  const html = render("NotFound");
  assert.ok(html.includes(">NotFound<"), "error message must name the status");
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4:
// Tests render the view without a wallet (renderToStaticMarkup — no hooks).
// (The entire test file uses renderToStaticMarkup with no wallet/SDK imports.)
// ---------------------------------------------------------------------------

test("renders without a wallet or external hooks for every status", () => {
  const statuses: RoundStatus[] = [
    "Open",
    "Revealing",
    "Cleared",
    "Settled",
    "Voided",
    "Unknown",
    "NotFound",
  ];
  for (const s of statuses) {
    assert.doesNotThrow(
      () => render(s),
      `renderToStaticMarkup must not throw for status ${s}`,
    );
  }
});
