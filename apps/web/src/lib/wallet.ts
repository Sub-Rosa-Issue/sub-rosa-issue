import { StellarWalletsKit, WalletNetwork, allowAllModules } from "@creit.tech/stellar-wallets-kit";
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

const WALLET_KIT_NETWORK = WalletNetwork.TESTNET;
let kitInstance: StellarWalletsKit | null = null;

function getWalletsKit(): StellarWalletsKit {
  if (typeof window === "undefined") {
    throw new Error("Wallets Kit is only available in the browser");
  }
  if (!kitInstance) {
    kitInstance = new StellarWalletsKit({
      modules: allowAllModules(),
      network: WALLET_KIT_NETWORK,
    });
  }
  return kitInstance;
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

    const kit = getWalletsKit();

    return new Promise((resolve, reject) => {
      kit.openModal({
        onWalletSelected: async (option) => {
          try {
            kit.setWallet(option.id);

            let address: string | undefined;
            try {
              address = await kit.getPublicKey();
            } catch {
              throw new Error("Wallets Kit did not return an address");
            }

            if (!address) {
              throw new Error("Wallets Kit did not return an address");
            }

            let networkDetails: any;
            try {
              networkDetails = await kit.getNetwork();
            } catch {
              networkDetails = { network: WALLET_KIT_NETWORK, networkPassphrase: WALLET_KIT_NETWORK };
            }

            let networkPassphrase = networkDetails?.networkPassphrase || networkDetails?.network || WALLET_KIT_NETWORK;

            this.name = option.name ?? option.id ?? this.name;
            this.address = address;
            this.network = {
              network: networkPassphrase,
              networkPassphrase: networkPassphrase,
            };
            this.connected = true;
            this.lastError = null;

            const support = option.id.toLowerCase();
            if (support.includes("xbull") || support.includes("albedo")) {
              this.capabilities.signAuthEntry = false;
            } else {
              this.capabilities.signAuthEntry = true;
            }

            resolve();
          } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            reject(e);
          }
        },
      });
    });
  }

  async disconnect(): Promise<void> {
    if (typeof window === "undefined") return;
    const kit = getWalletsKit();
    // Some wallets don't support disconnect, but kit exposes disconnect
    // wait, kit.disconnect() is not on the instance in some versions?
    // In v2.4, it's just kit.disconnect() or nothing.
    // If it throws we ignore
    try {
      if ((kit as any).disconnect) {
        await (kit as any).disconnect();
      }
    } catch {}
    
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
    const kit = getWalletsKit();
    const signed = await kit.signTransaction(xdr, opts);
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
    const kit = getWalletsKit();
    // Note: older Wallets Kit might not type signAuthEntry correctly, cast if needed
    const signed = await (kit as any).signAuthEntry(entryXdr, opts);
    if (!signed || !signed.signedAuthEntry) {
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
