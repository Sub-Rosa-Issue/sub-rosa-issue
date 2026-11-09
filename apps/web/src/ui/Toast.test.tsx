// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";

import { TimeProvider } from "../lib/time";
import {
  ToastProvider,
  canRestoreFocus,
  useToast,
  type FocusableTarget,
} from "./Toast";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makeFocusable(overrides: Partial<FocusableTarget> = {}) {
  let focusCalls = 0;
  const target: FocusableTarget & { readonly focusCalls: number } = {
    isConnected: true,
    disabled: false,
    focus() {
      focusCalls += 1;
    },
    get focusCalls() {
      return focusCalls;
    },
    ...overrides,
  };
  return target;
}

async function mountToastHarness() {
  const fakeTime = createFakeTime(1_700_000_000_000);
  let api!: ReturnType<typeof useToast>;
  let renderer!: ReactTestRenderer;

  function Consumer() {
    api = useToast();
    return createElement("button", { type: "button", id: "trigger" }, "Action");
  }

  await act(async () => {
    renderer = create(
      createElement(
        TimeProvider,
        { value: fakeTime },
        createElement(ToastProvider, null, createElement(Consumer)),
      ),
    );
  });

  return {
    fakeTime,
    get api() {
      return api;
    },
    get renderer() {
      return renderer;
    },
    unmount: () => act(async () => renderer.unmount()),
  };
}

test("returns keyboard focus to the opener action when dismissed via close button", async () => {
  const h = await mountToastHarness();
  try {
    const opener = makeFocusable();
    let toastId = "";
    await act(async () => {
      toastId = h.api.push("info", "Round created", "Round #7 is open", {
        returnFocusTo: opener,
      });
    });
    assert.equal( toastId, "toast-1");
    assert.equal(opener.focusCalls, 0);

    const closeBtn = h.renderer.root.findByProps({
      className: "toast-close",
    });
    await act(async () => {
      closeBtn.props.onClick();
    });

    assert.equal(opener.focusCalls, 1);
    // Dismissing an already-dismissed toast is a no-op and does not refocus.
    await act(async () => {
      h.api.dismiss(toastId, { restoreFocus: true });
    });
    assert.equal(opener.focusCalls, 1);
  } finally {
    await h.unmount();
  }
});

test("supports keyboard-only Escape dismissal and restores focus to the opener", async () => {
  const h = await mountToastHarness();
  try {
    const opener = makeFocusable();
    await act(async () => {
      h.api.push("error", "Submission failed", "Check RPC connection", {
        returnFocusTo: opener,
      });
    });

    const toastNode = h.renderer.root.find(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("toast-error") &&
        typeof node.props.onKeyDown === "function",
    );

    let prevented = false;
    let stopped = false;
    await act(async () => {
      toastNode.props.onKeyDown({
        key: "Escape",
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
      });
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(opener.focusCalls, 1);
  } finally {
    await h.unmount();
  }
});

test("auto-dismiss timeout does not steal focus from the user's current control", async () => {
  const h = await mountToastHarness();
  try {
    const opener = makeFocusable();
    let toastId = "";
    await act(async () => {
      toastId = h.api.push("success", "Bid committed", undefined, {
        returnFocusTo: opener,
      });
    });

    await act(async () => {
      h.fakeTime.scheduler.advance(5000);
    });

    assert.equal(opener.focusCalls, 0);
    // Toast was already auto-dismissed, so a subsequent manual dismiss does not refocus.
    await act(async () => {
      h.api.dismiss(toastId, { restoreFocus: true });
    });
    assert.equal(opener.focusCalls, 0);
  } finally {
    await h.unmount();
  }
});

test("skips focus restoration when the opener is disconnected or disabled", async () => {
  const disconnected = makeFocusable({ isConnected: false });
  const disabled = makeFocusable({ disabled: true });
  const ariaDisabled = makeFocusable({
    getAttribute: (name) => (name === "aria-disabled" ? "true" : null),
  });

  assert.equal(canRestoreFocus(disconnected), false);
  assert.equal(canRestoreFocus(disabled), false);
  assert.equal(canRestoreFocus(ariaDisabled), false);
  assert.equal(canRestoreFocus(makeFocusable()), true);

  const h = await mountToastHarness();
  try {
    let id = "";
    await act(async () => {
      id = h.api.push("info", "Detached trigger", undefined, {
        returnFocusTo: disconnected,
      });
    });
    await act(async () => {
      h.api.dismiss(id, { restoreFocus: true });
    });
    assert.equal(disconnected.focusCalls, 0);
  } finally {
    await h.unmount();
  }
});
