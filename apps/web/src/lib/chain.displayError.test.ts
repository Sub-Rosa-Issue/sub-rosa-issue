// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test, mock } from "node:test";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

// freighter-api ships as a UMD bundle Node cannot import by name, so stub it
// before loading the real chain helper and testing its error formatting.
mock.module("@stellar/freighter-api", {
  namedExports: {
    getAddress: async () => ({ address: "" }),
    getNetworkDetails: async () => ({ network: "", networkUrl: "", networkPassphrase: "" }),
    signAuthEntry: async () => ({ signedAuthEntry: null, signerAddress: "" }),
    signTransaction: async () => ({ signedTxXdr: "", signerAddress: "" }),
  },
});

const { displayError, sdkClientNetworkPassphrase } = await import("./chain");
const { DemoNetworkMismatchError } = await import("./network-guard");

test("sdkClientNetworkPassphrase reads the SDK client's configured network", () => {
  assert.equal(sdkClientNetworkPassphrase(null), "");
  assert.equal(sdkClientNetworkPassphrase(undefined), "");
  assert.equal(
    sdkClientNetworkPassphrase({ options: { networkPassphrase: PUBLIC } } as never),
    PUBLIC,
  );
});

test("displayError surfaces both networks for a demo network mismatch", () => {
  const error = new DemoNetworkMismatchError({
    action: "commit",
    chainPassphrase: PUBLIC,
    sdkPassphrase: TESTNET,
  });
  const message = displayError(error);
  assert.match(message, /Public/);
  assert.match(message, /Testnet/);
  // Not collapsed to the generic public message.
  assert.doesNotMatch(message, /could not be completed/i);
});
