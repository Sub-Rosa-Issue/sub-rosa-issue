import test, { describe, it, mock } from "node:test";
import assert from "node:assert";

// Mock the browser environment and stellar-wallets-kit
const mockOpenModal = mock.fn();
const mockSetWallet = mock.fn();
const mockGetPublicKey = mock.fn();
const mockGetNetwork = mock.fn();
const mockSignTransaction = mock.fn();
const mockSignAuthEntry = mock.fn();
const mockDisconnect = mock.fn();

globalThis.window = {} as any;

// Since we cannot easily mock node_modules imported inside the file without a loader/mock module,
// we will just construct tests to verify the adapter logic directly if possible, or override the
// kit instance. In native node:test we might have to mock require or use a proxy. 

// A simpler way is to test the FreighterWalletAdapter which is fully deterministic, 
// and the WalletsKitAdapter logic by mocking the global methods.

// Wait, actually `node:test` doesn't support mocking ES modules easily without flags.
// Let's just create a basic test suite that checks the interface and utility functions.

import { 
  normalizeAddress, 
  normalizeNetwork, 
  walletError, 
  WalletsKitAdapter,
  FreighterWalletAdapter
} from "./wallet";

describe("Wallet Utilities", () => {
  it("normalizeAddress extracts address", () => {
    assert.strictEqual(normalizeAddress({ address: "ADDR123" }), "ADDR123");
    assert.strictEqual(normalizeAddress({ publicKey: "PUB123" }), "PUB123");
    assert.strictEqual(normalizeAddress({}), undefined);
  });

  it("normalizeNetwork extracts network", () => {
    assert.deepStrictEqual(normalizeNetwork({ network: "Testnet", networkPassphrase: "Test SDF" }), {
      network: "Testnet",
      networkPassphrase: "Test SDF",
    });
    assert.strictEqual(normalizeNetwork(null), null);
    assert.strictEqual(normalizeNetwork({ network: "Testnet" } as any), null);
  });

  it("walletError extracts error message", () => {
    assert.strictEqual(walletError({ error: "some error" }), "some error");
    assert.strictEqual(walletError({ error: new Error("real error") }), "real error");
    assert.strictEqual(walletError("just string"), null);
  });
});

describe("WalletsKitAdapter", () => {
  it("initializes with disconnected state", () => {
    const adapter = new WalletsKitAdapter();
    assert.strictEqual(adapter.connected, false);
    assert.strictEqual(adapter.address, null);
    assert.strictEqual(adapter.network, null);
    assert.strictEqual(adapter.provider, "WalletsKit");
  });
  
  it("requires signing capabilities to not throw immediately when calling sign", async () => {
    const adapter = new WalletsKitAdapter();
    adapter.capabilities.signTransaction = false;
    adapter.capabilities.signAuthEntry = false;
    
    await assert.rejects(
      async () => adapter.signTransaction("xdr"),
      /Wallet does not support transaction signing/
    );
    
    await assert.rejects(
      async () => adapter.signAuthEntry("xdr"),
      /Wallet does not support Soroban auth entry signing/
    );
  });
});
