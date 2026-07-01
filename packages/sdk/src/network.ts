import { SubRosaNetworkMismatchError } from "./errors.js";

export interface KnownNetwork {
  label: string;
  networkPassphrase: string;
  rpcUrlPattern: RegExp;
}

export const KNOWN_NETWORKS: KnownNetwork[] = [
  {
    label: "Stellar Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrlPattern: /soroban-testnet\.stellar\.org/,
  },
  {
    label: "Stellar Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrlPattern: /rpc\.ankr\.com/,
  },
];

function detectNetwork(opts: {
  networkPassphrase?: string;
  rpcUrl?: string;
}): KnownNetwork | undefined {
  if (opts.networkPassphrase) {
    const byPassphrase = KNOWN_NETWORKS.find(
      (n) => n.networkPassphrase === opts.networkPassphrase,
    );
    if (byPassphrase) return byPassphrase;
  }
  if (opts.rpcUrl) {
    const url: string = opts.rpcUrl;
    const byUrl = KNOWN_NETWORKS.find((n) => n.rpcUrlPattern.test(url));
    if (byUrl) return byUrl;
  }
  return undefined;
}

export function assertNetworkConfig(options: {
  networkPassphrase: string;
  rpcUrl: string;
  allowHttp?: boolean;
}): void {
  const { networkPassphrase, rpcUrl } = options;

  if (!networkPassphrase || typeof networkPassphrase !== "string") {
    throw new SubRosaNetworkMismatchError(
      networkPassphrase,
      rpcUrl,
      "network passphrase is required",
    );
  }

  const passphraseNetwork = detectNetwork({ networkPassphrase });
  const rpcNetwork = detectNetwork({ rpcUrl });

  if (!passphraseNetwork) {
    return;
  }

  if (passphraseNetwork && rpcNetwork && passphraseNetwork !== rpcNetwork) {
    throw new SubRosaNetworkMismatchError(
      networkPassphrase,
      rpcUrl,
      `network passphrase ${JSON.stringify(networkPassphrase)} (${passphraseNetwork.label}) does not match RPC URL ${JSON.stringify(rpcUrl)} (${rpcNetwork.label})`,
    );
  }
}
