// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";

import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "../lib/reduced-motion";
import { TimeProvider } from "../lib/time";
import { ConfettiBurst } from "./Confetti";
import { CountUp, formatCountUpValue } from "./CountUp";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const UI_DIR = dirname(fileURLToPath(import.meta.url));

function readWebSource(relPath: string): string {
  return readFileSync(resolve(UI_DIR, "..", relPath), "utf8");
}

test("prefersReducedMotion evaluates matchMedia('(prefers-reduced-motion: reduce)') and explicit overrides", () => {
  assert.equal(prefersReducedMotion(true), true);
  assert.equal(prefersReducedMotion(false), false);

  const matchingEnv = {
    matchMedia(query: string) {
      return { matches: query === REDUCED_MOTION_QUERY };
    },
  };
  assert.equal(prefersReducedMotion(undefined, matchingEnv), true);

  const nonMatchingEnv = {
    matchMedia() {
      return { matches: false };
    },
  };
  assert.equal(prefersReducedMotion(undefined, nonMatchingEnv), false);
});

test("ConfettiBurst disables confetti particles and timers when reduced motion is enabled", () => {
  const fakeTime = createFakeTime(1_700_000_000_000);
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <TimeProvider value={fakeTime}>
        <ConfettiBurst fire={1} count={20} reducedMotion={true} />
      </TimeProvider>,
    );
  });

  assert.equal(renderer.toJSON(), null, "ConfettiBurst must render null when reducedMotion is true");

  act(() => {
    renderer.update(
      <TimeProvider value={fakeTime}>
        <ConfettiBurst fire={2} count={20} reducedMotion={true} />
      </TimeProvider>,
    );
  });

  assert.equal(renderer.toJSON(), null, "ConfettiBurst must stay null when fire increments under reducedMotion");
});

test("ConfettiBurst renders confetti layer when reduced motion is false", () => {
  const fakeTime = createFakeTime(1_700_000_000_000);
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <TimeProvider value={fakeTime}>
        <ConfettiBurst fire={1} count={6} reducedMotion={false} />
      </TimeProvider>,
    );
  });

  const layers = renderer.root.findAllByProps({ className: "confetti-layer" });
  assert.equal(layers.length, 1);
});

test("CountUp renders final formatted value immediately when reduced motion is enabled", () => {
  assert.equal(
    formatCountUpValue(1234567, { prefix: "R ", suffix: " ok" }),
    "R 1,234,567 ok",
  );

  const html = renderToStaticMarkup(
    <CountUp value={987654} prefix="R " reducedMotion={true} />,
  );

  assert.equal(html, '<span data-reduced-motion="true">R 987,654</span>');
});

test("App shell configures MotionConfig reducedMotion='user' and base.css disables nonessential motion", () => {
  const appSource = readWebSource("App.tsx");
  const baseCss = readWebSource("styles/base.css");

  assert.match(appSource, /<MotionConfig reducedMotion="user">/);
  assert.match(baseCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(baseCss, /scroll-behavior:\s*auto\s*!important/);
  assert.match(baseCss, /\.confetti-layer,\s*\.seal-pulse\s*\{[\s\S]*?display:\s*none\s*!important/);
});
