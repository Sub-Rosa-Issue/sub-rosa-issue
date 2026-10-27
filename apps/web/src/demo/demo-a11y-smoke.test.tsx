// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeTime } from "@sub-rosa/time";

import { AttackDemo, SealOffColumn, StepList } from "../components/AttackDemo";
import { RoundStatusBadge } from "../components/RoundStatusBadge";
import type { AttackStep } from "../lib/demoTypes";
import { TimeProvider } from "../lib/time";
import { ToastProvider } from "../ui/Toast";

const DEMO_DIR = dirname(fileURLToPath(import.meta.url));

function readWebSource(relPath: string): string {
  return readFileSync(resolve(DEMO_DIR, "..", relPath), "utf8");
}

const SAMPLE_STEPS: AttackStep[] = [
  { label: "Bidder A commits", detail: "Commitment hash H recorded on-chain", ok: true },
  { label: "Observer inspects before R", detail: "Plaintext bid leaked early", ok: false },
];

test("demo default state exposes landmarks, region roles, headings, and focusable controls", () => {
  const html = renderToStaticMarkup(
    <TimeProvider value={createFakeTime(1_700_000_000_000)}>
      <ToastProvider>
        <RoundStatusBadge state="empty" message="Create or join a round" />
        <AttackDemo phase="Reveal" />
      </ToastProvider>
    </TimeProvider>,
  );

  assert.match(html, /role="status"[^>]*aria-busy="false"[^>]*>.*<span class="round-status-label">Empty<\/span>/);
  assert.match(html, /<section class="panel attack-panel" aria-label="Seal-off vs seal-on attack">/);
  assert.match(html, /<h2>Seal-off vs seal-on attack<\/h2>/);
  assert.match(html, /<div class="attack-col bad" role="region" aria-label="Seal OFF — broken commit-reveal">/);
  assert.match(html, /<div class="attack-col good" role="region" aria-label="Seal ON — Sub Rosa \+ Drand tlock">/);
  assert.match(
    html,
    /<button type="button" class="btn primary" aria-busy="false">Run live attack comparison<\/button>/,
  );
});

test("demo loading state sets aria-busy, status role, and decorative spinner attributes", () => {
  const html = renderToStaticMarkup(
    <RoundStatusBadge state="loading" message="Fetching round state" />,
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<span class="round-status-spinner" aria-hidden="true"><\/span>/);
  assert.match(html, /<span class="round-status-label">Loading<\/span>/);
});

test("demo error state exposes alert role, error copy, and focusable retry control", () => {
  const html = renderToStaticMarkup(
    <RoundStatusBadge
      state="error"
      error="RPC connection timed out"
      onRetry={() => {}}
    />,
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /<span class="round-status-icon" aria-hidden="true">!<\/span>/);
  assert.match(html, /<span class="round-status-label">Error<\/span>/);
  assert.match(html, /<span class="round-status-err">RPC connection timed out<\/span>/);
  assert.match(html, /<button type="button" class="round-status-retry">Retry<\/button>/);
});

test("demo seal-on state exposes named list and hides decorative status marks from assistive tech", () => {
  const html = renderToStaticMarkup(
    <StepList steps={SAMPLE_STEPS} variant="good" />,
  );

  assert.match(html, /<ul class="attack-steps good" aria-label="Seal-on protection steps">/);
  assert.match(html, /<span class="attack-mark" aria-hidden="true">✓<\/span>/);
  assert.match(html, /<strong>Bidder A commits<\/strong>/);
});

test("demo seal-off state withholds values while round is Open and exposes named list once Reveal opens", () => {
  const closedHtml = renderToStaticMarkup(
    <SealOffColumn steps={SAMPLE_STEPS} revealOpen={false} />,
  );
  assert.match(closedHtml, /Bids still sealed — values hidden until Drand R opens the reveal round\./);
  assert.doesNotMatch(closedHtml, /Plaintext bid leaked early/);

  const openHtml = renderToStaticMarkup(
    <SealOffColumn steps={SAMPLE_STEPS} revealOpen={true} />,
  );
  assert.match(openHtml, /<ul class="attack-steps bad" aria-label="Seal-off attack steps">/);
  assert.match(openHtml, /<span class="attack-mark" aria-hidden="true">✗<\/span>/);
  assert.match(openHtml, /Plaintext bid leaked early/);
});

test("DemoPage source defines navigation landmark, tablist roles, error alert, and sealed vs leaky list labels", () => {
  const demoPageSource = readWebSource("pages/DemoPage.tsx");

  assert.match(demoPageSource, /<aside className="case-nav" aria-label="Demo navigation">/);
  assert.match(demoPageSource, /<div className="mode-switch" role="tablist" aria-label="Demo mode">/);
  assert.match(demoPageSource, /role="tab"/);
  assert.match(demoPageSource, /aria-selected=\{mode === "live"\}/);
  assert.match(demoPageSource, /aria-selected=\{mode === "evidence"\}/);
  assert.match(demoPageSource, /<ul className="example-list" aria-label="Visible to everyone">/);
  assert.match(demoPageSource, /<ul className="example-list sealed" aria-label="Sealed until reveal">/);
  assert.match(demoPageSource, /className="evidence-intro evidence-intro--error" role="alert"/);
});
