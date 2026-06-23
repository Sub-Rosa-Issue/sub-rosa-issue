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

export interface FreighterApi {
  isConnected: () => Promise<{ isConnected: boolean; error?: unknown }>;
  requestAccess: () => Promise<{ address?: string; publicKey?: string; error?: unknown }>;
  getNetworkDetails: () => Promise<{ network: string; networkPassphrase: string; error?: unknown }>;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress: string; error?: unknown }>;
  signAuthEntry: (
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedAuthEntry: string | null; signerAddress: string; error?: unknown }>;
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

export interface WalletsKitProvider {
  name?: string;
  isConnected?: () => Promise<boolean | { isConnected: boolean }>;
  requestAccess?: () => Promise<WalletConnectionResult>;
  getAddress?: () => Promise<WalletConnectionResult>;
  getNetworkDetails?: () => Promise<WalletNetworkDetails>;
  signTransaction?: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry?: (
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedAuthEntry: string; signerAddress: string }>;
  disconnect?: () => Promise<void>;
}

export class WalletsKitAdapter implements WalletAdapter {
  readonly name: string;
  readonly provider = "WalletsKit" as const;
  address: string | null = null;
  network: WalletNetworkDetails | null = null;
  capabilities: WalletCapabilities = {
    signTransaction: false,
    signAuthEntry: false,
  };
  connected = false;
  lastError: string | null = null;

  constructor(private providerObject: WalletsKitProvider) {
    this.name = providerObject.name ?? "Wallets Kit";
    this.capabilities = {
      signTransaction: typeof providerObject.signTransaction === "function",
      signAuthEntry: typeof providerObject.signAuthEntry === "function",
    };
  }

  private async providerIsConnected(): Promise<boolean> {
    if (!this.providerObject.isConnected) return false;
    const result = await this.providerObject.isConnected();
    if (typeof result === "boolean") return result;
    return Boolean(result?.isConnected);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const connected = await this.providerIsConnected();
    let access: WalletConnectionResult | undefined;
    if (connected) {
      if (this.providerObject.getAddress) {
        access = await this.providerObject.getAddress();
      }
    } else if (this.providerObject.requestAccess) {
      access = await this.providerObject.requestAccess();
    }

    if (!access && this.providerObject.getAddress) {
      access = await this.providerObject.getAddress();
    }

    const address = normalizeAddress(access ?? {});
    if (!address) {
      throw new Error("Wallets Kit provider did not return an address");
    }

    if (!this.providerObject.getNetworkDetails) {
      throw new Error("Wallets Kit provider does not expose network details");
    }

    const networkDetails = await this.providerObject.getNetworkDetails();
    const network = normalizeNetwork(networkDetails);
    if (!network) {
      throw new Error("Wallets Kit provider returned invalid network details");
    }

    this.address = address;
    this.network = network;
    this.capabilities = {
      signTransaction: typeof this.providerObject.signTransaction === "function",
      signAuthEntry: typeof this.providerObject.signAuthEntry === "function",
    };
    this.connected = true;
    this.lastError = null;
  }

  async disconnect(): Promise<void> {
    await this.providerObject.disconnect?.();
    this.address = null;
    this.network = null;
    this.connected = false;
    this.lastError = null;
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    if (!this.capabilities.signTransaction || !this.providerObject.signTransaction) {
      throw new Error("Wallet does not support transaction signing");
    }
    const signed = await this.providerObject.signTransaction(xdr, opts);
    if (!signed.signedTxXdr || !signed.signerAddress) {
      throw new Error("Wallets Kit provider returned an invalid signed transaction");
    }
    return signed;
  }

  async signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress: string }> {
    if (!this.capabilities.signAuthEntry || !this.providerObject.signAuthEntry) {
      throw new Error("Wallet does not support Soroban auth entry signing");
    }
    const signed = await this.providerObject.signAuthEntry(entryXdr, opts);
    if (!signed.signedAuthEntry || !signed.signerAddress) {
      throw new Error("Wallets Kit provider returned an invalid signed auth entry");
    }
    return signed;
  }
}

export function detectWalletsKitProvider(): WalletsKitProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const globalAny = window as any;
  return (
    globalAny.Stellar?.walletsKit ??
    globalAny.Stellar?.WalletsKit ??
    globalAny.stellarWalletsKit ??
    globalAny.walletsKit ??
    undefined
  );
}

let walletAdapterInstance: WalletAdapter | null = null;

export function getWalletAdapter(): WalletAdapter {
  const provider = detectWalletsKitProvider();
  if (walletAdapterInstance) {
    if (walletAdapterInstance.provider === "Freighter" && provider) {
      walletAdapterInstance = new WalletsKitAdapter(provider);
    }
    return walletAdapterInstance;
  }
  walletAdapterInstance = provider ? new WalletsKitAdapter(provider) : new FreighterWalletAdapter();
  return walletAdapterInstance;
}

export function resetWalletAdapter(): void {
  walletAdapterInstance = null;
}
