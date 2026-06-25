import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";

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

export function normalizeAddress(access: WalletConnectionResult): string | undefined {
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

export function walletError(result: { error?: unknown } | unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const error = (result as { error?: unknown }).error ?? undefined;
  if (!error) return null;
  return typeof error === "string"
    ? error
    : error instanceof Error
    ? error.message
    : String(error);
}

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

const WALLET_KIT_NETWORK = Networks.TESTNET;
let walletsKitInitialized = false;

function initializeWalletsKit(): void {
  if (walletsKitInitialized || typeof window === "undefined") return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: WALLET_KIT_NETWORK,
  });
  walletsKitInitialized = true;
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

  async connect(): Promise<void> {
    if (this.connected) return;
    if (typeof window === "undefined") {
      throw new Error("Wallets Kit is only available in the browser");
    }

    initializeWalletsKit();

    let address: string | undefined;
    try {
      const access = await StellarWalletsKit.authModal();
      address = access.address;
    } catch {
      const fallback = await StellarWalletsKit.fetchAddress();
      address = fallback.address;
    }

    if (!address) {
      throw new Error("Wallets Kit did not return an address");
    }

    const networkDetails = await StellarWalletsKit.getNetwork();
    const network = normalizeNetwork(networkDetails);
    if (!network) {
      throw new Error("Wallets Kit returned invalid network details");
    }

    if (network.networkPassphrase !== WALLET_KIT_NETWORK) {
      throw new Error(`Switch your wallet to Testnet (current: ${network.network}).`);
    }

    this.name = StellarWalletsKit.selectedModule?.productName ?? this.name;
    this.address = address;
    this.network = network;
    this.connected = true;
    this.lastError = null;
  }

  async disconnect(): Promise<void> {
    if (typeof window === "undefined") return;
    initializeWalletsKit();
    await StellarWalletsKit.disconnect();
    this.address = null;
    this.network = null;
    this.connected = false;
    this.lastError = null;
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    if (!this.capabilities.signTransaction) {
      throw new Error("Wallet does not support transaction signing");
    }
    const signed = await StellarWalletsKit.signTransaction(xdr, opts);
    if (!signed.signedTxXdr) {
      throw new Error("Wallets Kit returned an invalid signed transaction");
    }
    return {
      signedTxXdr: signed.signedTxXdr,
      signerAddress:
        signed.signerAddress ?? opts?.address ?? this.address ?? "",
    };
  }

  async signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress: string }> {
    if (!this.capabilities.signAuthEntry) {
      throw new Error("Wallet does not support Soroban auth entry signing");
    }
    const signed = await StellarWalletsKit.signAuthEntry(entryXdr, opts);
    if (!signed.signedAuthEntry) {
      throw new Error("Wallets Kit returned an invalid signed auth entry");
    }
    return {
      signedAuthEntry: signed.signedAuthEntry,
      signerAddress:
        signed.signerAddress ?? opts?.address ?? this.address ?? "",
    };
  }
}

let walletAdapterInstance: WalletAdapter | null = null;

export function getWalletAdapter(): WalletAdapter {
  if (walletAdapterInstance) return walletAdapterInstance;
  walletAdapterInstance = new WalletsKitAdapter();
  return walletAdapterInstance;
}

export function resetWalletAdapter(): void {
  walletAdapterInstance = null;
}
