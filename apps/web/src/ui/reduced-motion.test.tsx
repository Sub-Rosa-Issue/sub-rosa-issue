// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";
import { TimeProvider } from "../lib/time";
import { ConfettiBurst } from "./Confetti";
import { CountUp } from "./CountUp";
import { ToastProvider, useToast } from "./Toast";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function ToastTrigger() {
  const { push } = useToast();
  return (
    <button
      type="button"
      data-testid="push"
      onClick={() => push("success", "Bid sealed", "Ciphertext stored")}
    >
      Trigger
    </button>
  );
}

describe("reduced-motion accessibility preferences", () => {
  it("suppresses decorative ConfettiBurst particles and timers when reducedMotion is enabled", () => {
    const fakeTime = createFakeTime(1_000);
    let tree!: TestRenderer.ReactTestRenderer;

    act(() => {
      tree = TestRenderer.create(
        <TimeProvider value={fakeTime}>
          <ConfettiBurst fire={1} count={20} reducedMotion={true} />
        </TimeProvider>,
      );
    });

    assert.equal(tree.toJSON(), null);
    assert.equal(fakeTime.scheduler.pendingCount(), 0);
  });

  it("writes the final formatted value immediately in CountUp when reducedMotion is enabled", () => {
    const spanNode = { textContent: "" };
    let tree!: TestRenderer.ReactTestRenderer;

    act(() => {
      tree = TestRenderer.create(
        <CountUp
          value={1250.5}
          decimals={1}
          prefix="$"
          suffix=" USDC"
          reducedMotion={true}
        />,
        {
          createNodeMock: (element) => {
            if (element.type === "span") return spanNode;
            return null;
          },
        },
      );
    });

    assert.equal(spanNode.textContent, "$1,250.5 USDC");

    act(() => {
      tree.update(
        <CountUp
          value={2500}
          decimals={1}
          prefix="$"
          suffix=" USDC"
          reducedMotion={true}
        />,
      );
    });

    assert.equal(spanNode.textContent, "$2,500.0 USDC");
  });

  it("preserves core Toast feedback and auto-dismissal while using a static progress bar under reducedMotion", () => {
    const fakeTime = createFakeTime(1_000);
    let tree!: TestRenderer.ReactTestRenderer;

    act(() => {
      tree = TestRenderer.create(
        <TimeProvider value={fakeTime}>
          <ToastProvider reducedMotion={true}>
            <ToastTrigger />
          </ToastProvider>
        </TimeProvider>,
      );
    });

    const triggerBtn = tree.root.findByProps({ "data-testid": "push" });
    act(() => {
      triggerBtn.props.onClick();
    });

    const staticBars = tree.root.findAll(
      (node) =>
        node.type === "i" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("toast-bar-static"),
    );
    assert.equal(staticBars.length, 1);

    const titles = tree.root.findAll(
      (node) => node.type === "strong" && node.children.includes("Bid sealed"),
    );
    assert.equal(titles.length, 1);

    act(() => {
      fakeTime.scheduler.advance(5_000);
    });

    const remaining = tree.root.findAll(
      (node) => node.type === "strong" && node.children.includes("Bid sealed"),
    );
    assert.equal(remaining.length, 0);
  });

  it("enforces prefers-reduced-motion media queries in stylesheets and MotionConfig at the app root", () => {
    const baseCss = readFileSync(resolve(WEB_ROOT, "src/styles/base.css"), "utf8");
    const feedbackCss = readFileSync(resolve(WEB_ROOT, "src/styles/feedback.css"), "utf8");
    const appCss = readFileSync(resolve(WEB_ROOT, "src/styles/app.css"), "utf8");
    const appTsx = readFileSync(resolve(WEB_ROOT, "src/App.tsx"), "utf8");

    assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(baseCss, /scroll-behavior:\s*auto/);
    assert.match(feedbackCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(feedbackCss, /\.toast-spinner[\s\S]*animation:\s*none/);
    assert.match(appCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(appTsx, /<MotionConfig\s+reducedMotion="user">/);
  });
});
