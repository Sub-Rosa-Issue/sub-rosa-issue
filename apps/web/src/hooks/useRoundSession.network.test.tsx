// Copyright (c) 2026 Sub Rosa contributors
// Regression tests for the demo network guard. The chain helper is stubbed so
// the detected wallet passphrase and the SDK client passphrase can be pointed
// at different networks.
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";
import { USE_CASES } from "../config/useCases";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { clock } = createFakeTime(1_700_000_000_000);
const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

let chainPassphrase = TESTNET;
let sdkPassphrase = TESTNET;
let revealing = false;
const calls: string[] = [];
const toasts: Array<{ tone: string; title: string; body: string }> = [];
let sequence = 0;

const wrapped = (value: unknown) => ({ result: { unwrap: () => value } });
const contract = {
  options: { networkPassphrase: TESTNET },
  get_round: async () =>
    wrapped({
      status: { tag: revealing ? "Revealing" : "Open" },
      commit_deadline: BigInt(clock.nowSeconds() + 100),
      reveal_round: 1n,
      auditor_pubkey: new Uint8Array(96),
    }),
  get_bidders: async () => wrapped(["bidder-a"]),
  get_bid_state: async () => wrapped({ revealed_value: null }),
  get_seal: async () => ({ result: { ciphertext: new Uint8Array([1]) } }),
  commit: async () => {
    calls.push("commit");
    return {
      signAndSend: async () => {
        calls.push("commit-sign");
        return wrapped(1n);
      },
    };
  },
  reveal: async () => {
    calls.push("reveal");
    return {
      signAndSend: async () => {
        calls.push("reveal-sign");
        return wrapped(undefined);
      },
    };
  },
};

// Stub the chain helper: its passphrase readers are the seam these tests use.
mock.module(new URL("../lib/chain.ts", import.meta.url).href, {
  namedExports: {
    CONTRACT_ID: "contract",
    NETWORK: TESTNET,
    LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS: 10,
    LIVE_COMMIT_WINDOW_SECONDS: 27,
    LIVE_REVEAL_IN_SECONDS: 37,
    LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS: 240,
    useWalletContract: () => contract,
    displayError: (e: Error) => e.message,
    formatDemoAmount: String,
    freighterError: () => null,
    resolveFreighterAddress: async () => "wallet",
    detectChainNetworkPassphrase: async () => chainPassphrase,
    sdkClientNetworkPassphrase: () => sdkPassphrase,
    sha256Bytes: async () => new Uint8Array(32),
    toDemoEscrowAmount: (n: number) => BigInt(n),
  },
});
mock.module(new URL("../ui/Toast.tsx", import.meta.url).href, {
  namedExports: {
    useToast: () => ({
      push: (tone: string, title: string, body: string) => {
        toasts.push({ tone, title: title ?? "", body: body ?? "" });
        return String(++sequence);
      },
      dismiss: () => {},
    }),
  },
});
mock.module(new URL("../lib/time.tsx", import.meta.url).href, {
  namedExports: { useTime: () => ({ clock }) },
});
mock.module(new URL("./useDrandCountdown.ts", import.meta.url).href, {
  namedExports: { useDrandCountdown: () => ({ published: true }), formatCountdown: String },
});
mock.module("@stellar/freighter-api", {
  namedExports: {
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({}),
    getNetworkDetails: async () => ({ networkPassphrase: chainPassphrase, network: "TESTNET" }),
  },
});
mock.module("@sub-rosa/tlock", {
  namedExports: {
    quicknet: () => ({}),
    openBid: async () => ({ value: 1n, nonce: new Uint8Array(32) }),
    fetchRoundSignature: async () => new Uint8Array(),
    generateAuditorKeypair: () => ({ publicKey: new Uint8Array(96) }),
    generateNonce: () => new Uint8Array(),
    roundInSeconds: async () => 1,
    sealBid: async () => ({
      commitment: new Uint8Array(32),
      ciphertext: new Uint8Array(8),
      auditorBlob: new Uint8Array(8),
    }),
  },
});
const { useRoundSession } = await import("./useRoundSession");

async function mount() {
  chainPassphrase = TESTNET;
  sdkPassphrase = TESTNET;
  revealing = false;
  calls.length = 0;
  toasts.length = 0;
  let session!: ReturnType<typeof useRoundSession>;
  function Harness() {
    session = useRoundSession(USE_CASES[0]);
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => {
    await session.connect();
  });
  await act(async () => {
    await session.joinRound("7");
  });
  return {
    get session() {
      return session;
    },
    unmount: () => act(async () => renderer.unmount()),
  };
}

test("matching passphrases allow the fixture commit action", async () => {
  const h = await mount();
  try {
    await act(async () => {
      await h.session.commitEntry();
    });
    assert.equal(h.session.status, "ok");
    assert.ok(calls.includes("commit-sign"));
    assert.equal(h.session.networkMismatch, null);
  } finally {
    await h.unmount();
  }
});

test("a mismatch blocks commit and surfaces both networks without a secret", async () => {
  const h = await mount();
  try {
    chainPassphrase = PUBLIC;
    sdkPassphrase = TESTNET;
    await act(async () => {
      await h.session.commitEntry();
    });
    assert.equal(h.session.status, "error");
    assert.ok(!calls.includes("commit"), "commit must not be submitted");
    assert.deepEqual(h.session.networkMismatch, {
      chainNetwork: "Public",
      sdkNetwork: "Testnet",
    });
    const failure = toasts.find((t) => t.title === "Commit failed");
    assert.ok(failure, "expected a Commit failed toast");
    assert.match(failure.body, /Public/);
    assert.match(failure.body, /Testnet/);
    assert.doesNotMatch(failure.body, /AAAA/);
    assert.doesNotMatch(failure.body, /\bS[A-Z2-7]{55}\b/);
  } finally {
    await h.unmount();
  }
});

test("a mismatch blocks reveal", async () => {
  const h = await mount();
  try {
    await act(async () => {
      await h.session.commitEntry();
    });
    chainPassphrase = PUBLIC;
    sdkPassphrase = TESTNET;
    revealing = true;
    await act(async () => {
      await h.session.openAndReveal();
    });
    assert.equal(h.session.status, "error");
    assert.ok(!calls.includes("reveal"), "reveal must not be submitted");
    const failure = toasts.find((t) => t.title === "Reveal failed");
    assert.ok(failure, "expected a Reveal failed toast");
    assert.match(failure.body, /Public/);
    assert.match(failure.body, /Testnet/);
  } finally {
    await h.unmount();
  }
});
