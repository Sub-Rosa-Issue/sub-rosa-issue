/**
 * @file wallet.test.ts
 *
 * Realistic adapter tests for WalletsKitAdapter and FreighterWalletAdapter.
 * Uses Vitest + vi.mock to mock the static StellarWalletsKit class so no real
 * wallet extension is required.
 *
 * Covered scenarios
 * -----------------
 *  Wallet Utilities      – normalizeAddress, normalizeNetwork, walletError
 *  WalletsKitAdapter
 *    Connect             – successful connection, wallet selected, address returned
 *    Reconnect           – re-connect resets state and invokes authModal again
 *    Rejection           – user rejects → adapter error state, no connected flag
 *    Wrong network       – signing APIs blocked, Soroban auth blocked, contract execution blocked
 *    signTransaction     – signed xdr returned, state preserved
 *    signAuthEntry       – signed auth entry returned
 *    Unsupported cap     – missing signAuthEntry capability → explicit typed error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Networks,
  type ModuleInterface,
  type ISupportedWallet,
  KitEventType,
  type KitEventStateUpdated,
  type KitEventWalletSelected,
  type KitEventDisconnected,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";

// ─── Mock the entire static StellarWalletsKit class ──────────────────────────
// We need to mock before importing wallet.ts so the module sees the mocked
// version. vi.mock is hoisted automatically by Vitest.

vi.mock("@creit.tech/stellar-wallets-kit", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@creit.tech/stellar-wallets-kit")>();
  return {
    ...original, // keep Networks, KitEventType, etc.
    StellarWalletsKit: {
      init: vi.fn(),
      setWallet: vi.fn(),
      authModal: vi.fn(),
      getAddress: vi.fn(),
      getNetwork: vi.fn(),
      signTransaction: vi.fn(),
      signAuthEntry: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      refreshSupportedWallets: vi.fn(),
      createButton: vi.fn(),
      profileModal: vi.fn(),
      fetchAddress: vi.fn(),
      setNetwork: vi.fn(),
      setTheme: vi.fn(),
      signMessage: vi.fn(),
      signAndSubmitTransaction: vi.fn(),
      // selectedModule is a getter — provide a configurable default
      get selectedModule() {
        return fakeModule;
      },
    },
  };
});

// Mock module subpath imports (module classes — just need no-arg constructors).
vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FreighterModule: class FreighterModule {
    moduleType = "HOT_WALLET";
    productId = "freighter";
    productName = "Freighter";
    productUrl = "";
    productIcon = "";
    isAvailable = vi.fn().mockResolvedValue(true);
    getAddress = vi.fn().mockResolvedValue({ address: "" });
    signTransaction = vi.fn();
    signAuthEntry = vi.fn();
    signMessage = vi.fn();
    getNetwork = vi.fn();
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({
  AlbedoModule: class AlbedoModule {
    moduleType = "HOT_WALLET";
    productId = "albedo";
    productName = "Albedo";
    productUrl = "";
    productIcon = "";
    isAvailable = vi.fn().mockResolvedValue(true);
    getAddress = vi.fn().mockResolvedValue({ address: "" });
    signTransaction = vi.fn();
    signMessage = vi.fn();
    getNetwork = vi.fn();
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({
  xBullModule: class xBullModule {
    moduleType = "HOT_WALLET";
    productId = "xbull";
    productName = "xBull";
    productUrl = "";
    productIcon = "";
    isAvailable = vi.fn().mockResolvedValue(true);
    getAddress = vi.fn().mockResolvedValue({ address: "" });
    signTransaction = vi.fn();
    signMessage = vi.fn();
    getNetwork = vi.fn();
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/lobstr", () => ({
  LobstrModule: class LobstrModule {
    moduleType = "HOT_WALLET";
    productId = "lobstr";
    productName = "LOBSTR";
    productUrl = "";
    productIcon = "";
    isAvailable = vi.fn().mockResolvedValue(true);
    getAddress = vi.fn().mockResolvedValue({ address: "" });
    signTransaction = vi.fn();
    signAuthEntry = vi.fn();
    signMessage = vi.fn();
    getNetwork = vi.fn();
  },
}));

// ---------------------------------------------------------------------------
// Fake module with full capabilities (default)
// ---------------------------------------------------------------------------

const fakeModule: ModuleInterface = {
  moduleType: "HOT_WALLET" as ModuleInterface["moduleType"],
  productId: "freighter",
  productName: "Freighter",
  productUrl: "https://freighter.app",
  productIcon: "",
  isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  isPlatformWrapper: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  getAddress: vi
    .fn<(params?: { skipRequestAccess?: boolean }) => Promise<{ address: string }>>()
    .mockResolvedValue({ address: "GTEST_ADDRESS_FAKE_1111111111111111111" }),
  signTransaction: vi
    .fn<(xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>>()
    .mockResolvedValue({ signedTxXdr: "signed_xdr_fake", signerAddress: "GTEST" }),
  signAuthEntry: vi
    .fn<(entryXdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedAuthEntry: string; signerAddress?: string }>>()
    .mockResolvedValue({ signedAuthEntry: "signed_auth_fake", signerAddress: "GTEST" }),
  signMessage: vi
    .fn<(message: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedMessage: string; signerAddress?: string }>>()
    .mockResolvedValue({ signedMessage: "signed_msg_fake" }),
  getNetwork: vi
    .fn<() => Promise<{ network: string; networkPassphrase: string }>>()
    .mockResolvedValue({
      network: "Testnet",
      networkPassphrase: Networks.TESTNET,
    }),
};

// ---------------------------------------------------------------------------
// Import the adapter AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  WalletsKitAdapter,
  FreighterWalletAdapter,
  WrongNetworkError,
  UnsupportedCapabilityError,
  normalizeAddress,
  normalizeNetwork,
  walletError,
  resetWalletAdapter,
  REQUIRED_NETWORK_PASSPHRASE,
} from "./wallet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ADDRESS = "GTEST_ADDRESS_FAKE_1111111111111111111";
const TESTNET_PASSPHRASE = Networks.TESTNET; // "Test SDF Network ; September 2015"

/** Cast StellarWalletsKit mock to easily override mocked methods per-test. */
const mockKit = StellarWalletsKit as unknown as {
  init: ReturnType<typeof vi.fn>;
  authModal: ReturnType<typeof vi.fn>;
  getNetwork: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  signAuthEntry: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  selectedModule: ModuleInterface;
};

/** Default authModal success response. */
function setupSuccessfulConnect() {
  mockKit.authModal.mockResolvedValue({ address: TEST_ADDRESS });
  mockKit.getNetwork.mockResolvedValue({
    network: "Testnet",
    networkPassphrase: TESTNET_PASSPHRASE,
  });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("Wallet Utilities", () => {
  it("normalizeAddress extracts address field", () => {
    expect(normalizeAddress({ address: "ADDR123" })).toBe("ADDR123");
  });

  it("normalizeAddress falls back to publicKey", () => {
    expect(normalizeAddress({ publicKey: "PUB123" })).toBe("PUB123");
  });

  it("normalizeAddress returns undefined when both fields absent", () => {
    expect(normalizeAddress({})).toBeUndefined();
  });

  it("normalizeNetwork returns a clean object for valid input", () => {
    expect(
      normalizeNetwork({ network: "Testnet", networkPassphrase: "Test SDF" }),
    ).toEqual({ network: "Testnet", networkPassphrase: "Test SDF" });
  });

  it("normalizeNetwork returns null for null input", () => {
    expect(normalizeNetwork(null)).toBeNull();
  });

  it("normalizeNetwork returns null when passphrase is missing", () => {
    expect(
      normalizeNetwork({ network: "Testnet" } as any),
    ).toBeNull();
  });

  it("walletError extracts a string error", () => {
    expect(walletError({ error: "boom" })).toBe("boom");
  });

  it("walletError extracts an Error object message", () => {
    expect(walletError({ error: new Error("real error") })).toBe("real error");
  });

  it("walletError returns null for non-object input", () => {
    expect(walletError("just a string")).toBeNull();
  });

  it("walletError returns null when no error field present", () => {
    expect(walletError({ data: 42 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — initial state", () => {
  it("initialises with disconnected state", () => {
    const adapter = new WalletsKitAdapter();
    expect(adapter.connected).toBe(false);
    expect(adapter.address).toBeNull();
    expect(adapter.network).toBeNull();
    expect(adapter.provider).toBe("WalletsKit");
    expect(adapter.lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — Connect (success)", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(() => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();
    adapter = new WalletsKitAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls StellarWalletsKit.init exactly once", async () => {
    await adapter.connect();
    expect(mockKit.init).toHaveBeenCalledTimes(1);
  });

  it("calls authModal to open wallet selection", async () => {
    await adapter.connect();
    expect(mockKit.authModal).toHaveBeenCalledTimes(1);
  });

  it("sets connected = true after success", async () => {
    await adapter.connect();
    expect(adapter.connected).toBe(true);
  });

  it("stores the address returned by authModal", async () => {
    await adapter.connect();
    expect(adapter.address).toBe(TEST_ADDRESS);
  });

  it("stores the network passphrase returned by getNetwork", async () => {
    await adapter.connect();
    expect(adapter.network?.networkPassphrase).toBe(TESTNET_PASSPHRASE);
  });

  it("clears lastError on success", async () => {
    await adapter.connect();
    expect(adapter.lastError).toBeNull();
  });

  it("detects signTransaction capability from selectedModule", async () => {
    await adapter.connect();
    expect(adapter.capabilities.signTransaction).toBe(true);
  });

  it("detects signAuthEntry capability from selectedModule", async () => {
    await adapter.connect();
    expect(adapter.capabilities.signAuthEntry).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — Reconnect", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(() => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();
    adapter = new WalletsKitAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("re-invokes authModal on a second connect() call", async () => {
    await adapter.connect();
    expect(mockKit.authModal).toHaveBeenCalledTimes(1);

    // Second call (reconnect scenario)
    await adapter.connect();
    expect(mockKit.authModal).toHaveBeenCalledTimes(2);
  });

  it("preserves correct address after reconnect", async () => {
    await adapter.connect();

    const newAddress = "GNEW_ADDRESS_FAKE_99999";
    mockKit.authModal.mockResolvedValueOnce({ address: newAddress });
    await adapter.connect();

    expect(adapter.address).toBe(newAddress);
    expect(adapter.connected).toBe(true);
  });

  it("resets state before re-opening authModal", async () => {
    await adapter.connect();

    // Simulate modal being aborted on reconnect (throws)
    mockKit.authModal.mockRejectedValueOnce(new Error("User cancelled"));

    await expect(adapter.connect()).rejects.toThrow("User cancelled");
    expect(adapter.connected).toBe(false);
    expect(adapter.address).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — Connection Rejection", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(() => {
    resetWalletAdapter();
    vi.clearAllMocks();
    adapter = new WalletsKitAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws when user rejects the wallet modal", async () => {
    mockKit.authModal.mockRejectedValue(new Error("User rejected connection"));
    await expect(adapter.connect()).rejects.toThrow("User rejected connection");
  });

  it("sets lastError when user rejects", async () => {
    mockKit.authModal.mockRejectedValue(new Error("User rejected connection"));
    try {
      await adapter.connect();
    } catch {
      /* expected */
    }
    expect(adapter.lastError).toBe("User rejected connection");
  });

  it("leaves connected = false when user rejects", async () => {
    mockKit.authModal.mockRejectedValue(new Error("User rejected connection"));
    try {
      await adapter.connect();
    } catch {
      /* expected */
    }
    expect(adapter.connected).toBe(false);
  });

  it("leaves address = null when user rejects", async () => {
    mockKit.authModal.mockRejectedValue(new Error("User rejected connection"));
    try {
      await adapter.connect();
    } catch {
      /* expected */
    }
    expect(adapter.address).toBeNull();
  });

  it("UI state resets correctly — network remains null after rejection", async () => {
    mockKit.authModal.mockRejectedValue(new Error("Wallet denied"));
    try {
      await adapter.connect();
    } catch {
      /* expected */
    }
    expect(adapter.network).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — Wrong Network", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(async () => {
    resetWalletAdapter();
    vi.clearAllMocks();

    // Connect to WRONG network (mainnet passphrase).
    mockKit.authModal.mockResolvedValue({ address: TEST_ADDRESS });
    mockKit.getNetwork.mockResolvedValue({
      network: "Public",
      networkPassphrase: Networks.PUBLIC,
    });

    adapter = new WalletsKitAdapter();
    await adapter.connect();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adapter is connected but on the wrong network", () => {
    expect(adapter.connected).toBe(true);
    expect(adapter.network?.networkPassphrase).toBe(Networks.PUBLIC);
    expect(adapter.network?.networkPassphrase).not.toBe(
      REQUIRED_NETWORK_PASSPHRASE,
    );
  });

  it("signTransaction throws WrongNetworkError — adapter blocks signing", async () => {
    await expect(adapter.signTransaction("raw_xdr")).rejects.toBeInstanceOf(
      WrongNetworkError,
    );
  });

  it("signTransaction does NOT call StellarWalletsKit.signTransaction on wrong network", async () => {
    try {
      await adapter.signTransaction("raw_xdr");
    } catch {
      /* expected WrongNetworkError */
    }
    expect(mockKit.signTransaction).not.toHaveBeenCalled();
  });

  it("signAuthEntry throws WrongNetworkError — Soroban auth blocked", async () => {
    await expect(adapter.signAuthEntry("auth_entry_xdr")).rejects.toBeInstanceOf(
      WrongNetworkError,
    );
  });

  it("signAuthEntry does NOT call StellarWalletsKit.signAuthEntry on wrong network", async () => {
    try {
      await adapter.signAuthEntry("auth_entry_xdr");
    } catch {
      /* expected WrongNetworkError */
    }
    expect(mockKit.signAuthEntry).not.toHaveBeenCalled();
  });

  it("WrongNetworkError carries the connected passphrase", async () => {
    try {
      await adapter.signTransaction("raw_xdr");
    } catch (e) {
      expect(e).toBeInstanceOf(WrongNetworkError);
      expect((e as WrongNetworkError).connectedPassphrase).toBe(Networks.PUBLIC);
    }
  });

  it("WrongNetworkError message is descriptive", async () => {
    await expect(adapter.signTransaction("raw_xdr")).rejects.toThrow(
      /wrong network/i,
    );
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — signTransaction (success)", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(async () => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();

    adapter = new WalletsKitAdapter();
    await adapter.connect();

    mockKit.signTransaction.mockResolvedValue({
      signedTxXdr: "signed_tx_xdr_result",
      signerAddress: TEST_ADDRESS,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the xdr to StellarWalletsKit.signTransaction", async () => {
    await adapter.signTransaction("my_xdr");
    expect(mockKit.signTransaction).toHaveBeenCalledWith(
      "my_xdr",
      undefined,
    );
  });

  it("returns the signedTxXdr from the kit", async () => {
    const result = await adapter.signTransaction("my_xdr");
    expect(result.signedTxXdr).toBe("signed_tx_xdr_result");
  });

  it("returns the signerAddress from the kit", async () => {
    const result = await adapter.signTransaction("my_xdr");
    expect(result.signerAddress).toBe(TEST_ADDRESS);
  });

  it("preserves adapter.connected after signing", async () => {
    await adapter.signTransaction("my_xdr");
    expect(adapter.connected).toBe(true);
  });

  it("preserves adapter.address after signing", async () => {
    await adapter.signTransaction("my_xdr");
    expect(adapter.address).toBe(TEST_ADDRESS);
  });

  it("passes through opts.networkPassphrase to the kit", async () => {
    await adapter.signTransaction("my_xdr", {
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    expect(mockKit.signTransaction).toHaveBeenCalledWith("my_xdr", {
      networkPassphrase: TESTNET_PASSPHRASE,
    });
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — signAuthEntry (Soroban auth-entry signing)", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(async () => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();

    adapter = new WalletsKitAdapter();
    await adapter.connect();

    mockKit.signAuthEntry.mockResolvedValue({
      signedAuthEntry: "signed_auth_entry_result",
      signerAddress: TEST_ADDRESS,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the auth entry xdr to StellarWalletsKit.signAuthEntry", async () => {
    await adapter.signAuthEntry("auth_entry_xdr");
    expect(mockKit.signAuthEntry).toHaveBeenCalledWith(
      "auth_entry_xdr",
      undefined,
    );
  });

  it("returns the signedAuthEntry from the kit", async () => {
    const result = await adapter.signAuthEntry("auth_entry_xdr");
    expect(result.signedAuthEntry).toBe("signed_auth_entry_result");
  });

  it("returns the signerAddress from the kit", async () => {
    const result = await adapter.signAuthEntry("auth_entry_xdr");
    expect(result.signerAddress).toBe(TEST_ADDRESS);
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — Unsupported Capability (signAuthEntry)", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(async () => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();

    adapter = new WalletsKitAdapter();
    await adapter.connect();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnsupportedCapabilityError when signAuthEntry is disabled", async () => {
    adapter.capabilities.signAuthEntry = false;
    await expect(adapter.signAuthEntry("entry_xdr")).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
  });

  it("does NOT call kit.signAuthEntry when capability is disabled", async () => {
    adapter.capabilities.signAuthEntry = false;
    try {
      await adapter.signAuthEntry("entry_xdr");
    } catch {
      /* expected */
    }
    expect(mockKit.signAuthEntry).not.toHaveBeenCalled();
  });

  it("UnsupportedCapabilityError carries the capability name", async () => {
    adapter.capabilities.signAuthEntry = false;
    try {
      await adapter.signAuthEntry("entry_xdr");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedCapabilityError);
      expect((e as UnsupportedCapabilityError).capability).toContain(
        "Soroban auth entry signing",
      );
    }
  });

  it("throws UnsupportedCapabilityError when signTransaction is disabled", async () => {
    adapter.capabilities.signTransaction = false;
    await expect(adapter.signTransaction("xdr")).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
  });

  it("does NOT call kit.signTransaction when capability is disabled", async () => {
    adapter.capabilities.signTransaction = false;
    try {
      await adapter.signTransaction("xdr");
    } catch {
      /* expected */
    }
    expect(mockKit.signTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("WalletsKitAdapter — disconnect", () => {
  let adapter: WalletsKitAdapter;

  beforeEach(async () => {
    resetWalletAdapter();
    vi.clearAllMocks();
    setupSuccessfulConnect();
    mockKit.disconnect.mockResolvedValue(undefined);

    adapter = new WalletsKitAdapter();
    await adapter.connect();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets connected = false after disconnect", async () => {
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
  });

  it("clears address after disconnect", async () => {
    await adapter.disconnect();
    expect(adapter.address).toBeNull();
  });

  it("clears network after disconnect", async () => {
    await adapter.disconnect();
    expect(adapter.network).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("REQUIRED_NETWORK_PASSPHRASE constant", () => {
  it("equals the Testnet passphrase from the Wallets Kit Networks enum", () => {
    expect(REQUIRED_NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
  });
});
