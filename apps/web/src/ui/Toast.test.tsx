// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class FakeElement {
  public isConnected = true;
  public focused = 0;
  public children: FakeElement[] = [];
  constructor(public id = "", public parent: FakeElement | null = null) {}
  focus() {
    this.focused += 1;
    (globalThis.document as FakeDocument).activeElement = this;
  }
  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  append(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
  }
}
class FakeDocument {
  public activeElement: FakeElement | null = null;
  private elements = new Map<string, FakeElement>();
  getElementById(id: string) {
    return this.elements.get(id) ?? null;
  }
  register(el: FakeElement) {
    if (el.id) this.elements.set(el.id, el);
  }
}

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
const originalNode = globalThis.Node;

function installDom() {
  const doc = new FakeDocument();
  const body = new FakeElement("body");
  doc.register(body);
  doc.activeElement = body;
  (globalThis as any).document = doc;
  (globalThis as any).HTMLElement = FakeElement;
  (globalThis as any).Node = FakeElement;
  return { doc, body };
}

afterEach(() => {
  (globalThis as any).document = originalDocument;
  (globalThis as any).HTMLElement = originalHTMLElement;
  (globalThis as any).Node = originalNode;
  mock.restoreAll();
});

test("keyboard close restores focus to the trigger that opened the toast", async () => {
  const { doc, body } = installDom();
  const trigger = new FakeElement("trigger", body);
  body.append(trigger);
  doc.register(trigger);
  trigger.focus();

  mock.module(new URL("../lib/time.tsx", import.meta.url).href, {
    namedExports: { useTime: () => ({ scheduler: { setTimeout: () => 1, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {} } }) },
  });
  mock.module("framer-motion", {
    namedExports: {
      AnimatePresence: ({ children }: any) => children,
      motion: new Proxy({}, { get: () => (props: any) => createElement("div", props, props.children) }),
      useReducedMotion: () => false,
    },
  });
  const { ToastProvider, useToast } = await import(`./Toast.tsx?keyboard=${Date.now()}`);

  let api!: { push: (tone: any, title: string) => string };
  function Harness() { api = useToast(); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(ToastProvider, null, createElement(Harness))); });
  try {
    let id = "";
    await act(async () => { id = api.push("info", "Saved"); });
    const close = renderer.root.findByProps({ "aria-label": "Dismiss: Saved" });
    const closeEl = new FakeElement(`${id}-close`, body);
    const toastEl = new FakeElement(id, body);
    toastEl.append(closeEl);
    body.append(toastEl);
    doc.register(closeEl); doc.register(toastEl);
    closeEl.focus();
    await act(async () => { close.props.onClick({ currentTarget: closeEl }); });
    assert.equal(doc.activeElement, trigger);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test("Escape dismisses a toast when focus is inside it and restores trigger focus", async () => {
  const { doc, body } = installDom();
  const trigger = new FakeElement("trigger", body);
  body.append(trigger); doc.register(trigger); trigger.focus();
  mock.module(new URL("../lib/time.tsx", import.meta.url).href, {
    namedExports: { useTime: () => ({ scheduler: { setTimeout: () => 1, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {} } }) },
  });
  mock.module("framer-motion", {
    namedExports: {
      AnimatePresence: ({ children }: any) => children,
      motion: new Proxy({}, { get: () => (props: any) => createElement("div", props, props.children) }),
      useReducedMotion: () => false,
    },
  });
  const { ToastProvider, useToast } = await import(`./Toast.tsx?escape=${Date.now()}`);
  let api!: { push: (tone: any, title: string) => string };
  function Harness() { api = useToast(); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(ToastProvider, null, createElement(Harness))); });
  try {
    let id = "";
    await act(async () => { id = api.push("error", "Boom"); });
    const toast = renderer.root.findByProps({ id });
    const closeEl = new FakeElement(`${id}-close`, body);
    const toastEl = new FakeElement(id, body);
    toastEl.append(closeEl); body.append(toastEl); doc.register(closeEl); doc.register(toastEl);
    closeEl.focus();
    let prevented = false;
    await act(async () => { toast.props.onKeyDown({ key: "Escape", preventDefault: () => { prevented = true; } }); });
    assert.equal(prevented, true);
    assert.equal(doc.activeElement, trigger);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test("programmatic dismiss does not steal focus when user moved elsewhere", async () => {
  const { doc, body } = installDom();
  const trigger = new FakeElement("trigger", body);
  const elsewhere = new FakeElement("elsewhere", body);
  body.append(trigger); body.append(elsewhere); doc.register(trigger); doc.register(elsewhere); trigger.focus();
  mock.module(new URL("../lib/time.tsx", import.meta.url).href, {
    namedExports: { useTime: () => ({ scheduler: { setTimeout: () => 1, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {} } }) },
  });
  mock.module("framer-motion", {
    namedExports: {
      AnimatePresence: ({ children }: any) => children,
      motion: new Proxy({}, { get: () => (props: any) => createElement("div", props, props.children) }),
      useReducedMotion: () => false,
    },
  });
  const { ToastProvider, useToast } = await import(`./Toast.tsx?programmatic=${Date.now()}`);
  let api!: { push: (tone: any, title: string) => string; dismiss: (id: string) => void };
  function Harness() { api = useToast(); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(ToastProvider, null, createElement(Harness))); });
  try {
    let id = "";
    await act(async () => { id = api.push("working", "Working"); });
    elsewhere.focus();
    await act(async () => { api.dismiss(id); });
    assert.equal(doc.activeElement, elsewhere);
  } finally {
    await act(async () => renderer.unmount());
  }
});
