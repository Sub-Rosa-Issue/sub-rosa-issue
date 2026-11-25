// Copyright (c) 2026 Sub Rosa contributors
/**
 * Guards demo actions against wallet/SDK network mismatch.
 *
 * Ported from the upstream "block actions on chain passphrase mismatch"
 * change: a demo action must refuse to run when the network the page is
 * configured for differs from the network the wallet/SDK client will
 * actually sign on. Error messages are public-safe: they name networks
 * only, never secrets, keys, or XDR.
 */

export interface NetworkPair {
  configuredNetwork: string;
  walletNetwork: string;
}

/**
 * True when the configured passphrase and the wallet-reported passphrase
 * refer to the same Stellar network. Unknown passphrases only match when
 * both sides report the exact same string.
 */
export function passphrasesReferToSameNetwork(
  configuredPassphrase: string,
  walletPassphrase: string,
): boolean {
  return sameNetworkName(configuredPassphrase) === sameNetworkName(walletPassphrase);
}

/** Human-readable network label for a passphrase, or "Unknown network". */
export function networkDisplayName(passphrase: string): string {
  if (passphrase === "Public Global Stellar Network ; September 2015") return "Public";
  if (passphrase === "Test SDF Network ; September 2015") return "Testnet";
  if (passphrase === "Test SDF Future Network ; October 2022") return "Futurenet";
  if (passphrase === "Standalone Network ; February 2017") return "Standalone";
  return "Unknown network";
}

/**
 * The error thrown when a demo action detects a network mismatch.
 * The message intentionally contains no secrets or transaction data.
 */
export class NetworkMismatchError extends Error {
  constructor(pair: NetworkPair) {
    super(
      `Network mismatch: page is on ${networkDisplayName(pair.configuredNetwork)} ` +
        `but the wallet is on ${networkDisplayName(pair.walletNetwork)}`,
    );
    this.name = "NetworkMismatchError";
  }
}

/**
 * Throws NetworkMismatchError when the demo action must not run.
 * `walletPassphrase` comes from the connected wallet (e.g. Freighter's
 * getNetwork); `configuredPassphrase` is the page's VITE_NETWORK_PASSPHRASE.
 */
export function assertDemoNetworkAllowed(
  configuredPassphrase: string,
  walletPassphrase: string,
): void {
  if (!passphrasesReferToSameNetwork(configuredPassphrase, walletPassphrase)) {
    throw new NetworkMismatchError({
      configuredNetwork: configuredPassphrase,
      walletNetwork: walletPassphrase,
    });
  }
}

function sameNetworkName(passphrase: string): string {
  return networkDisplayName(passphrase);
}
