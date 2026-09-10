// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let time = createFakeTime();
let calls = 0;
let active = 0;
let peak = 0;
let read = async () => ({ label: "ok" });
mock.module(new URL("../lib/time.tsx", import.meta.url).href, { namedExports: { useTime: () => time } });
mock.module("@sub-rosa/sdk", { namedExports: { SubRosaClient: class {
  async getRound() { calls++; active++; peak = Math.max(peak, active); try { return await read(); } finally { active--; } }
  async getBidders() { return ["bidder"]; }
  async getBidState() { return { revealed_value: null }; }
} } });
const { useLiveRound } = await import("./useLiveRound");
function deferred() {
  let resolve!: (value: { label: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ label: string }>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function mount() {
  time = createFakeTime(); calls = 0; active = 0; peak = 0;
  let result!: ReturnType<typeof useLiveRound>;
  let renderer!: ReactTestRenderer;
  function Harness({ enabled, roundId }: { enabled: boolean; roundId: bigint }) {
    result = useLiveRound(enabled, 1000, { rpcUrl: "https://rpc.invalid", networkPassphrase: "test", contractId: "contract", roundId });
    return null;
  }
  await act(async () => { renderer = create(createElement(Harness, { enabled: true, roundId: 1n })); });
  return {
    get result() { return result; },
    update: (enabled: boolean, roundId = 1n) => act(async () => renderer.update(createElement(Harness, { enabled, roundId }))),
    unmount: () => act(async () => renderer.unmount()),
  };
}
test("slow cycles never overlap and next cycle starts after completion plus delay", async () => {
  const slow = deferred(); read = () => slow.promise;
  const h = await mount();
  try {
    await act(async () => time.scheduler.advance(5000));
    assert.equal(calls, 1); assert.equal(time.scheduler.pendingCount(), 0);
    await act(async () => slow.resolve({ label: "first" }));
    assert.equal(time.scheduler.pendingCount(), 1);
    read = async () => ({ label: "second" });
    await act(async () => time.scheduler.advance(999)); assert.equal(calls, 1);
    await act(async () => time.scheduler.advance(1)); assert.equal(calls, 2);
    assert.equal((h.result.live?.round as unknown as { label: string }).label, "second");
    assert.equal(peak, 1);
  } finally { await h.unmount(); }
});
for (const action of ["disable", "unmount"] as const) {
  test(`${action} during a request prevents later state and scheduling`, async () => {
    const slow = deferred(); read = () => slow.promise;
    const h = await mount();
    if (action === "disable") await h.update(false); else await h.unmount();
    await act(async () => slow.resolve({ label: "obsolete" }));
    assert.equal(h.result.live, null); assert.equal(time.scheduler.pendingCount(), 0);
    await act(async () => time.scheduler.advance(10_000)); assert.equal(calls, 1);
    if (action === "disable") await h.unmount();
  });
}
test("obsolete effect cannot publish or overlap a replacement effect", async () => {
  const slow = deferred(); read = () => slow.promise;
  const h = await mount();
  try {
    await h.update(true, 2n);
    assert.equal(calls, 1);
    read = async () => ({ label: "new-round" });
    await act(async () => slow.resolve({ label: "old-round" }));
    assert.equal(calls, 2); assert.equal(peak, 1);
    assert.equal((h.result.live?.round as unknown as { label: string }).label, "new-round");
    assert.equal(time.scheduler.pendingCount(), 1);
  } finally { await h.unmount(); }
});
test("failure exposes an error then successful polling clears it", async () => {
  read = async () => { throw new Error("RPC unavailable"); };
  const h = await mount();
  try {
    assert.equal(h.result.error, "RPC unavailable"); assert.equal(time.scheduler.pendingCount(), 1);
    read = async () => ({ label: "recovered" });
    await act(async () => time.scheduler.advance(1000));
    assert.equal(h.result.error, null); assert.ok(h.result.live);
  } finally { await h.unmount(); }
});
