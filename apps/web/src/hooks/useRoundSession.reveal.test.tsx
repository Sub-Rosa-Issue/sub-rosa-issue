// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";
import { USE_CASES } from "../config/useCases";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { clock } = createFakeTime(1_700_000_000_000);
let failAt = "";
let missing = false;
let revealing = false;
const calls: string[] = [];
const working = new Set<string>();
const messages: string[] = [];
let sequence = 0;
async function step(name: string) {
  calls.push(name);
  if (name === failAt) throw new Error(`failed at ${name}`);
}
const wrapped = (value: unknown) => ({ result: { unwrap: () => value } });
const contract = {
  get_round: async () => wrapped({ status: { tag: revealing ? "Revealing" : "Open" }, commit_deadline: BigInt(clock.nowSeconds() + 100), reveal_round: 1n, auditor_pubkey: new Uint8Array(96) }),
  get_bidders: async () => wrapped(["bidder-a", "bidder-b"]),
  get_bid_state: async () => wrapped({ revealed_value: null }),
  get_seal: async ({ bidder }: { bidder: string }) => { await step("lookup"); return { result: missing && bidder === "bidder-a" ? null : { ciphertext: new Uint8Array([1]) } }; },
  reveal: async () => { await step("build"); return { signAndSend: async () => step("sign") }; },
};
mock.module(new URL("../lib/chain.ts", import.meta.url).href, { namedExports: {
  CONTRACT_ID: "contract", NETWORK: "test", LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS: 10,
  LIVE_COMMIT_WINDOW_SECONDS: 27, LIVE_REVEAL_IN_SECONDS: 37, LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS: 240,
  useWalletContract: () => contract, displayError: (e: Error) => e.message,
  formatDemoAmount: String, freighterError: () => null, resolveFreighterAddress: async () => "wallet",
  sha256Bytes: async () => new Uint8Array(32), toDemoEscrowAmount: BigInt,
} });
mock.module(new URL("../ui/Toast.tsx", import.meta.url).href, { namedExports: { useToast: () => ({
  push: (tone: string, title: string) => { const id = String(++sequence); if (tone === "working") working.add(id); messages.push(title); return id; },
  dismiss: (id: string) => { working.delete(id); },
}) } });
mock.module(new URL("../lib/time.tsx", import.meta.url).href, { namedExports: { useTime: () => ({ clock }) } });
mock.module(new URL("./useDrandCountdown.ts", import.meta.url).href, { namedExports: {
  useDrandCountdown: () => ({ published: true }), formatCountdown: String,
} });
mock.module("@stellar/freighter-api", { namedExports: {
  isConnected: async () => ({ isConnected: true }), requestAccess: async () => ({}),
  getNetworkDetails: async () => ({ networkPassphrase: "test", network: "test" }),
} });
mock.module("@sub-rosa/tlock", { namedExports: {
  quicknet: () => ({}), openBid: async () => { await step("decrypt"); return { value: 1n, nonce: new Uint8Array(32) }; },
  fetchRoundSignature: async () => new Uint8Array(), generateAuditorKeypair: () => ({}), generateNonce: () => new Uint8Array(), roundInSeconds: async () => 1, sealBid: async () => ({}),
} });
const { useRoundSession } = await import("./useRoundSession");

for (const boundary of ["lookup", "decrypt", "build", "sign", "success", "missing"]) {
  test(`reveal ${boundary} dismisses all owned working toasts`, async () => {
    calls.length = 0; messages.length = 0; working.clear(); revealing = false;
    failAt = boundary; missing = boundary === "missing";
    let session!: ReturnType<typeof useRoundSession>;
    function Harness() { session = useRoundSession(USE_CASES[0]); return null; }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(Harness)); });
    try {
      await act(async () => { await session.connect(); });
      await act(async () => { await session.joinRound("7"); });
      revealing = true;
      await act(async () => { await session.openAndReveal(); });
      assert.equal(working.size, 0);
      assert.equal(session.revealProgress, null);
      if (["success", "missing"].includes(boundary)) {
        assert.equal(session.status, "ok");
        assert.ok(messages.includes("Reveal complete"));
        assert.equal(calls.filter((name) => name === "sign").length, missing ? 1 : 2);
        if (missing) assert.ok(messages.includes("Some bids skipped"));
      } else {
        assert.equal(session.status, "error");
        assert.ok(messages.includes("Reveal failed"));
        assert.equal(calls.at(-1), boundary);
      }
    } finally { await act(async () => renderer.unmount()); }
  });
}
