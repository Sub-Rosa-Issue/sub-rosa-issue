// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";
import { USE_CASES } from "../config/useCases";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { clock } = createFakeTime(1_700_000_000_000);
let wallet = "wallet-a";
let reader = async (roundId: bigint) => snapshot(roundId, "normal");
const wrapped = (value: unknown) => ({ result: { unwrap: () => value } });
function snapshot(roundId: bigint, label: string) {
  return { roundId, label, status: { tag: "Open" }, commit_deadline: BigInt(clock.nowSeconds() + 100), reveal_round: 1n, auditor_pubkey: new Uint8Array(96) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const contract = {
  get_round: async ({ round_id }: { round_id: bigint }) => wrapped(await reader(round_id)),
  get_bidders: async ({ round_id }: { round_id: bigint }) => wrapped([`bidder-${round_id}`]),
  get_bid_state: async () => wrapped({ revealed_value: null }),
  create_round: async () => ({ signAndSend: async () => wrapped(9n) }),
};
mock.module(new URL("../lib/chain.ts", import.meta.url).href, { namedExports: {
  CONTRACT_ID: "contract", NETWORK: "test", LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS: 10,
  LIVE_COMMIT_WINDOW_SECONDS: 27, LIVE_REVEAL_IN_SECONDS: 37, LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS: 240,
  useWalletContract: () => contract, displayError: (e: Error) => e.message,
  formatDemoAmount: String, freighterError: () => null, resolveFreighterAddress: async () => wallet,
  sha256Bytes: async () => new Uint8Array(32), toDemoEscrowAmount: BigInt,
} });
mock.module(new URL("../ui/Toast.tsx", import.meta.url).href, { namedExports: { useToast: () => ({ push: () => "toast", dismiss: () => {} }) } });
mock.module(new URL("../lib/time.tsx", import.meta.url).href, { namedExports: { useTime: () => ({ clock }) } });
mock.module(new URL("./useDrandCountdown.ts", import.meta.url).href, { namedExports: {
  useDrandCountdown: () => ({ published: true }), formatCountdown: String,
} });
mock.module("@stellar/freighter-api", { namedExports: {
  isConnected: async () => ({ isConnected: true }), requestAccess: async () => ({}),
  getNetworkDetails: async () => ({ networkPassphrase: "test", network: "test" }),
} });
mock.module("@sub-rosa/tlock", { namedExports: {
  quicknet: () => ({ chain: () => ({ info: async () => ({ genesis_time: clock.nowSeconds(), period: 3 }) }) }),
  openBid: async () => ({}), fetchRoundSignature: async () => new Uint8Array(),
  generateAuditorKeypair: () => ({ publicKey: new Uint8Array(96) }), generateNonce: () => new Uint8Array(),
  roundInSeconds: async () => 100, sealBid: async () => ({}),
} });
const { useRoundSession } = await import("./useRoundSession");
async function mount() {
  reader = async (id) => snapshot(id, "normal"); wallet = "wallet-a";
  let session!: ReturnType<typeof useRoundSession>;
  let renderer!: ReactTestRenderer;
  function Harness() { session = useRoundSession(USE_CASES[0]); return null; }
  await act(async () => { renderer = create(createElement(Harness)); });
  await act(async () => { await session.connect(); });
  await act(async () => { await session.joinRound("7"); });
  return { get session() { return session; }, unmount: () => act(async () => renderer.unmount()) };
}

test("round A cannot overwrite a joined round B", async () => {
  const h = await mount();
  try {
    const old = deferred<ReturnType<typeof snapshot>>();
    reader = (id) => id === 7n ? old.promise : Promise.resolve(snapshot(id, "new"));
    let pending!: Promise<void>;
    await act(async () => { pending = h.session.refresh(); });
    await act(async () => { await h.session.joinRound("8"); });
    assert.equal(h.session.roundId, 8n);
    await act(async () => { old.resolve(snapshot(7n, "old")); await pending; });
    assert.equal((h.session.live?.round as unknown as { roundId: bigint }).roundId, 8n);
    assert.deepEqual(h.session.live?.bidders, ["bidder-8"]);
  } finally { await h.unmount(); }
});
test("older same-round refresh cannot replace a newer snapshot", async () => {
  const h = await mount();
  try {
    const old = deferred<ReturnType<typeof snapshot>>();
    reader = () => old.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = h.session.refresh(); });
    reader = async (id) => snapshot(id, "new");
    await act(async () => { await h.session.refresh(); });
    await act(async () => { old.resolve(snapshot(7n, "old")); await pending; });
    assert.equal((h.session.live?.round as unknown as { label: string }).label, "new");
  } finally { await h.unmount(); }
});
for (const action of ["wallet", "unmount", "create"] as const) {
  test(`${action} invalidates pending refresh`, async () => {
    const h = await mount();
    const old = deferred<ReturnType<typeof snapshot>>();
    reader = () => old.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = h.session.refresh(); });
    reader = async (id) => snapshot(id, "new");
    if (action === "wallet") {
      wallet = "wallet-b";
      await act(async () => { await h.session.connect(); });
    } else if (action === "unmount") { await h.unmount(); }
    else { await act(async () => { await h.session.createRound(); }); }
    const accepted = h.session.live;
    await act(async () => { old.resolve(snapshot(7n, "old")); await pending; });
    assert.equal(h.session.live, accepted);
    if (action === "create") assert.equal(h.session.roundId, 9n);
    if (action !== "unmount") await h.unmount();
  });
}
