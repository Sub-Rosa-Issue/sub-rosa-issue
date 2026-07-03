import {
  StellarWalletsKit,
  Networks,
  type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface WalletNetworkDetails {
  network: string;
  networkPassphrase: string;
}

export interface WalletCapabilities {
  signTransaction: boolean;
  signAuthEntry: boolean;
}

export interface WalletConnectionResult {
  address?: string;
  publicKey?: string;
}

export interface WalletAdapter {
  name: string;
  provider: "Freighter" | "WalletsKit";
  address: string | null;
  network: WalletNetworkDetails | null;
  capabilities: WalletCapabilities;
  connected: boolean;
  lastError: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress: string }>;
}

// ---------------------------------------------------------------------------
// Typed error classes — callers can instanceof-check these
// ---------------------------------------------------------------------------

export class WrongNetworkError extends Error {
  readonly connectedPassphrase: string;
  constructor(connectedPassphrase: string) {
    super(
      `Wallet is connected to the wrong network ("${connectedPassphrase}"). ` +
        `Switch to Testnet to continue.`,
    );
    this.name = "WrongNetworkError";
    this.connectedPassphrase = connectedPassphrase;
  }
}

export class UnsupportedCapabilityError extends Error {
  readonly capability: string;
  constructor(capability: string) {
    super(`Wallet does not support ${capability}.`);
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
  }
}

// ---------------------------------------------------------------------------
// Utility helpers (pure — safe to unit-test directly)
// ---------------------------------------------------------------------------

export function normalizeAddress(
  access: WalletConnectionResult,
): string | undefined {
  return access.address ?? access.publicKey;
}

export function normalizeNetwork(
  network: WalletNetworkDetails | null | undefined,
): WalletNetworkDetails | null {
  if (!network) return null;
  if (!network.networkPassphrase || !network.network) return null;
  return {
    network: network.network,
    networkPassphrase: network.networkPassphrase,
  };
}

export function walletError(
  result: { error?: unknown } | unknown,
): string | null {
  if (!result || typeof result !== "object") return null;
  const error = (result as { error?: unknown }).error ?? undefined;
  if (!error) return null;
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);
}

// ---------------------------------------------------------------------------
// FreighterWalletAdapter — unchanged from original
// ---------------------------------------------------------------------------

export class FreighterWalletAdapter implements WalletAdapter {
  readonly name = "Freighter";
  readonly provider = "Freighter" as const;
  address: string | null = null;
  network: WalletNetworkDetails | null = null;
  capabilities: WalletCapabilities = {
    signTransaction: true,
    signAuthEntry: true,
  };
  connected = false;
  lastError: string | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    const checked = await isConnected();
    if (!checked.isConnected) {
      throw new Error("Freighter extension is not installed or not reachable");
    }

    const access = await requestAccess();
    const accessError = walletError(access);
    if (accessError) throw new Error(accessError);

    const address = normalizeAddress(access);
    if (!address) throw new Error("Freighter returned no address");

    const networkDetails = await getNetworkDetails();
    const networkError = walletError(networkDetails);
    if (networkError) throw new Error(networkError);

    const network = normalizeNetwork(networkDetails);
    if (!network) throw new Error("Freighter returned no network details");

    this.address = address;
    this.network = network;
    this.connected = true;
    this.lastError = null;
  }

  async disconnect(): Promise<void> {
    this.address = null;
    this.network = null;
    this.connected = false;
    this.lastError = null;
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    const signed = await signTransaction(xdr, {
      networkPassphrase: opts?.networkPassphrase,
      address: opts?.address,
    });
    const error = walletError(signed);
    if (error) throw new Error(error);
    if (!signed.signedTxXdr || !signed.signerAddress) {
      throw new Error("Freighter returned an invalid signed transaction");
    }
    return {
      signedTxXdr: signed.signedTxXdr,
      signerAddress: signed.signerAddress,
    };
  }

  async signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress: string }> {
    const signed = await signAuthEntry(entryXdr, {
      networkPassphrase: opts?.networkPassphrase,
      address: opts?.address,
    });
    const error = walletError(signed);
    if (error) throw new Error(error);
    if (!signed.signedAuthEntry || !signed.signerAddress) {
      throw new Error("Freighter returned an invalid signed auth entry");
    }
    return {
      signedAuthEntry: signed.signedAuthEntry,
      signerAddress: signed.signerAddress,
    };
  }
}

// ---------------------------------------------------------------------------
// WalletsKitAdapter — uses the static v2.4.0 StellarWalletsKit API
// ---------------------------------------------------------------------------

/**
 * The network passphrase that this app requires.
 * All signing operations will be blocked if the connected wallet reports a
 * different passphrase.
 */
export const REQUIRED_NETWORK_PASSPHRASE: string = Networks.TESTNET;

/** True once StellarWalletsKit.init() has been called. */
let kitInitialised = false;

/**
 * Initialise the static StellarWalletsKit singleton exactly once.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function ensureKitInitialised(): void {
  if (kitInitialised) return;
  if (typeof window === "undefined") {
    throw new Error("Wallets Kit is only available in the browser");
  }
  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new AlbedoModule(),
      new xBullModule(),
      new LobstrModule(),
    ],
    network: Networks.TESTNET,
  });
  kitInitialised = true;
}

/**
 * Derive capability flags from the currently selected module.
 * We detect auth-entry support by checking whether the module exposes the
 * method — every well-behaved ModuleInterface implementation has it, but some
 * bridge wallets (e.g. Albedo in certain configurations) may not.
 */
function detectCapabilities(module: ModuleInterface): WalletCapabilities {
  return {
    signTransaction: typeof module.signTransaction === "function",
    signAuthEntry: typeof module.signAuthEntry === "function",
  };
}

export class WalletsKitAdapter implements WalletAdapter {
  readonly provider = "WalletsKit" as const;
  name = "Stellar Wallets Kit";
  address: string | null = null;
  network: WalletNetworkDetails | null = null;
  capabilities: WalletCapabilities = {
    signTransaction: true,
    signAuthEntry: true,
  };
  connected = false;
  lastError: string | null = null;

  // -------------------------------------------------------------------------
  // connect()
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    // Allow re-connecting even when already connected (e.g. "Reconnect wallet"
    // button). Reset state first so the modal opens fresh.
    this.connected = false;
    this.address = null;
    this.network = null;
    this.lastError = null;

    ensureKitInitialised();

    try {
      // authModal() blocks until the user picks a wallet and grants access.
      // It returns { address } directly — no need to call getAddress() after.
      const { address } = await StellarWalletsKit.authModal();

      if (!address) {
        throw new Error("Wallets Kit did not return an address");
      }

      // Fetch the connected network.
      let networkDetails: { network: string; networkPassphrase: string };
      try {
        networkDetails = await StellarWalletsKit.getNetwork();
      } catch {
        // Fallback for wallets that don't expose network info.
        networkDetails = {
          network: "Testnet",
          networkPassphrase: Networks.TESTNET,
        };
      }

      // Detect capabilities from the selected module.
      const mod = StellarWalletsKit.selectedModule;
      const capabilities = detectCapabilities(mod);

      // Derive a human-readable wallet name from the module.
      const walletName =
        mod.productName.length > 0 ? mod.productName : this.name;

      this.name = walletName;
      this.address = address;
      this.network = {
        network: networkDetails.network,
        networkPassphrase: networkDetails.networkPassphrase,
      };
      this.capabilities = capabilities;
      this.connected = true;
      this.lastError = null;
    } catch (e: unknown) {
      this.connected = false;
      this.address = null;
      this.network = null;
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // disconnect()
  // -------------------------------------------------------------------------

  async disconnect(): Promise<void> {
    if (typeof window !== "undefined" && kitInitialised) {
      try {
        await StellarWalletsKit.disconnect();
      } catch {
        // Ignore — some wallets don't implement disconnect.
      }
    }
    this.address = null;
    this.network = null;
    this.connected = false;
    this.lastError = null;
  }

  // -------------------------------------------------------------------------
  // Network guard (adapter-level — callers cannot bypass this)
  // -------------------------------------------------------------------------

  private assertCorrectNetwork(): void {
    const passphrase = this.network?.networkPassphrase ?? "";
    if (passphrase !== REQUIRED_NETWORK_PASSPHRASE) {
      throw new WrongNetworkError(passphrase);
    }
  }

  // -------------------------------------------------------------------------
  // signTransaction()
  // -------------------------------------------------------------------------

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    // Wrong network → block immediately, strongly typed error.
    this.assertCorrectNetwork();

    if (!this.capabilities.signTransaction) {
      throw new UnsupportedCapabilityError("transaction signing");
    }

    const signed = await StellarWalletsKit.signTransaction(xdr, opts);

    if (!signed.signedTxXdr) {
      throw new Error("Wallets Kit returned an invalid signed transaction");
    }

    return {
      signedTxXdr: signed.signedTxXdr,
      signerAddress: signed.signerAddress ?? opts?.address ?? this.address ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // signAuthEntry()
  // -------------------------------------------------------------------------

  async signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress: string }> {
    // Wrong network → block immediately, strongly typed error.
    this.assertCorrectNetwork();

    if (!this.capabilities.signAuthEntry) {
      throw new UnsupportedCapabilityError("Soroban auth entry signing");
    }

    const signed = await StellarWalletsKit.signAuthEntry(entryXdr, opts);

    if (!signed.signedAuthEntry) {
      throw new Error("Wallets Kit returned an invalid signed auth entry");
    }

    return {
      signedAuthEntry: signed.signedAuthEntry,
      signerAddress: signed.signerAddress ?? opts?.address ?? this.address ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton helpers
// ---------------------------------------------------------------------------

let walletAdapterInstance: WalletAdapter | null = null;

export function getWalletAdapter(): WalletAdapter {
  if (walletAdapterInstance) return walletAdapterInstance;
  walletAdapterInstance = new WalletsKitAdapter();
  return walletAdapterInstance;
}

export function resetWalletAdapter(): void {
  walletAdapterInstance = null;
  // Also reset the kit init flag so tests can re-initialise cleanly.
  kitInitialised = false;
}
