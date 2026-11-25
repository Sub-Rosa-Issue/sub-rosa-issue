// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeTime } from "@sub-rosa/time";

import { DrandCountdownChip } from "./DrandCountdownChip";
import { TimeProvider } from "../lib/time";
import { timeOfRound, QUICKNET_PERIOD } from "../lib/countdown";

function renderChip(
  targetRound: number,
  nowMs: number,
  mode: "live-round" | "proof" = "live-round",
): string {
  const fake = createFakeTime(nowMs);
  return renderToStaticMarkup(
    <TimeProvider value={fake}>
      <DrandCountdownChip targetRound={targetRound} mode={mode} />
    </TimeProvider>,
  );
}

test("DrandCountdownChip: idle mode renders beacon ready", () => {
  const fake = createFakeTime(0);
  const html = renderToStaticMarkup(
    <TimeProvider value={fake}>
      <DrandCountdownChip mode="idle" />
    </TimeProvider>,
  );
  assert.match(html, /drand-footer idle/);
  assert.match(html, /Beacon ready/);
});

test("DrandCountdownChip: one millisecond before boundary, reveal stays disabled", () => {
  const targetRound = 10;
  const boundaryMs = timeOfRound(targetRound) * 1000;
  const html = renderChip(targetRound, boundaryMs - 1);

  assert.match(html, /drand-footer waiting/);
  assert.match(html, /Until round reveal/);
  assert.doesNotMatch(html, /Reveal unlocked/);
  assert.doesNotMatch(html, /published/);
});

test("DrandCountdownChip: at the boundary, reveal becomes available", () => {
  const targetRound = 10;
  const boundaryMs = timeOfRound(targetRound) * 1000;
  const html = renderChip(targetRound, boundaryMs);

  assert.match(html, /drand-footer published/);
  assert.match(html, /Reveal unlocked/);
  assert.doesNotMatch(html, /drand-footer waiting/);
});

test("DrandCountdownChip: reveal stays available through the last second of the period", () => {
  const targetRound = 10;
  const boundaryMs = timeOfRound(targetRound) * 1000;
  const endOfPeriodMs = boundaryMs + QUICKNET_PERIOD * 1000 - 1;
  const html = renderChip(targetRound, endOfPeriodMs);

  assert.match(html, /drand-footer published/);
  assert.match(html, /Reveal unlocked/);
});

test("DrandCountdownChip: proof mode renders proof labels", () => {
  const targetRound = 10;
  const boundaryMs = timeOfRound(targetRound) * 1000;

  const waitingHtml = renderChip(targetRound, boundaryMs - 1, "proof");
  assert.match(waitingHtml, /Until proof R/);

  const publishedHtml = renderChip(targetRound, boundaryMs, "proof");
  assert.match(publishedHtml, /Proof R live/);
});
