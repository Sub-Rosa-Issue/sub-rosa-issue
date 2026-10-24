// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";

import { TimeProvider } from "../lib/time";
import { ToastProvider, useToast, type FocusableElement, type FocusEnvironment } from "./Toast";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function createMockFocusEnv() {
  let active: FocusableElement | null = null;
  const body: FocusableElement = {
    isConnected: true,
    focus() {
      active = body;
    },
  };
  active = body;

  const makeElement = (name: string, children: Set<FocusableElement> = new Set()) => {
    const el: FocusableElement & { name: string; focusCount: number } = {
      name,
      focusCount: 0,
      isConnected: true,
      focus() {
        el.focusCount += 1;
        active = el;
      },
      contains(node: unknown) {
        return node === el || children.has(node as FocusableElement);
      },
    };
    return el;
  };

  const env: FocusEnvironment = {
    get activeElement() {
      return active;
    },
    get body() {
      return body;
    },
  };

  return {
    env,
    body,
    makeElement,
    setActive(el: FocusableElement | null) {
      active = el;
    },
  };
}

function ToastHarness({
  onReady,
}: {
  onReady: (api: ReturnType<typeof useToast>) => void;
}) {
  const api = useToast();
  onReady(api);
  return null;
}

test("Toast close button dismissal returns keyboard focus to the trigger control", () => {
  const fakeTime = createFakeTime(1_700_000_000_000);
  const { env, makeElement, setActive } = createMockFocusEnv();
  const triggerButton = makeElement("commit-bid-button");
  const closeButton = makeElement("toast-close-button");

  let toastApi!: ReturnType<typeof useToast>;
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <TimeProvider value={fakeTime}>
        <ToastProvider focusEnv={env}>
          <ToastHarness onReady={(api) => { toastApi = api; }} />
        </ToastProvider>
      </TimeProvider>,
    );
  });

  // Simulate user activating the trigger button, which opens a toast
  setActive(triggerButton);
  act(() => {
    toastApi.push("info", "Wallet connected", "Freighter ready");
  });

  // Simulate user tabbing into the toast's close button and activating it
  setActive(closeButton);
  const closeBtnInstance = renderer.root.findByProps({
    className: "toast-close",
  });
  act(() => {
    closeBtnInstance.props.onClick();
  });

  assert.equal(triggerButton.focusCount, 1);
  assert.equal(env.activeElement, triggerButton);
});

test("Escape key on a toast dismisses it and restores focus to the trigger control", () => {
  const fakeTime = createFakeTime(1_700_000_000_000);
  const { env, makeElement, setActive } = createMockFocusEnv();
  const triggerButton = makeElement("run-attack-demo-button");

  let toastApi!: ReturnType<typeof useToast>;
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <TimeProvider value={fakeTime}>
        <ToastProvider focusEnv={env}>
          <ToastHarness onReady={(api) => { toastApi = api; }} />
        </ToastProvider>
      </TimeProvider>,
    );
  });

  setActive(triggerButton);
  act(() => {
    toastApi.push("error", "Attack demo failed", "Network timeout");
  });

  const toastNode = renderer.root.find(
    (node) => typeof node.props.className === "string" && node.props.className.includes("toast-error"),
  );

  let defaultPrevented = false;
  let propagationStopped = false;
  act(() => {
    toastNode.props.onKeyDown({
      key: "Escape",
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      },
    });
  });

  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);
  assert.equal(triggerButton.focusCount, 1);
  assert.equal(env.activeElement, triggerButton);
});

test("async working -> completion toast sequence preserves the original opener on keyboard dismissal", () => {
  const fakeTime = createFakeTime(1_700_000_000_000);
  const { env, body, makeElement, setActive } = createMockFocusEnv();
  const triggerButton = makeElement("open-reveal-button");

  let toastApi!: ReturnType<typeof useToast>;
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <TimeProvider value={fakeTime}>
        <ToastProvider focusEnv={env}>
          <ToastHarness onReady={(api) => { toastApi = api; }} />
        </ToastProvider>
      </TimeProvider>,
    );
  });

  // 1. User activates triggerButton -> pushes a "working" toast
  setActive(triggerButton);
  let workingId = "";
  act(() => {
    workingId = toastApi.push("working", "Submitting reveal…");
  });

  // 2. While awaiting RPC, button becomes disabled and focus drops to document.body
  setActive(body);
  act(() => {
    toastApi.dismiss(workingId);
    toastApi.push("success", "Reveal submitted");
  });

  assert.equal(
    triggerButton.focusCount,
    0,
    "programmatic dismissal of working toast must not steal focus when not requested",
  );

  // 3. User dismisses the completion toast via keyboard
  const closeBtn = renderer.root.findByProps({
    "aria-label": "Dismiss: Reveal submitted",
  });
  act(() => {
    closeBtn.props.onClick();
  });

  assert.equal(triggerButton.focusCount, 1);
  assert.equal(env.activeElement, triggerButton);
});
