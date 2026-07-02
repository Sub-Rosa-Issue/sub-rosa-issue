import { MAINNET_ARTIFACTS } from "./mainnet-artifacts.js";
import { SubRosaNetworkMismatchError } from "./errors.js";

export const STELLAR_TESTNET_PASSPHRASE =
  "Test SDF Network ; September 2015";

export const STELLAR_PUBLIC_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";

export function validateNetworkPassphrase(
  networkPassphrase: string,
  rpcUrl: string,
): void {
  if (!networkPassphrase) {
    throw new SubRosaNetworkMismatchError("networkPassphrase is required");
  }

  const isTestnet = networkPassphrase === STELLAR_TESTNET_PASSPHRASE;
  const isPublic = networkPassphrase === STELLAR_PUBLIC_PASSPHRASE;

  // Custom/local passphrase — allow (bypass for sandbox/standalone nodes)
  if (!isTestnet && !isPublic) {
    return;
  }

  // Testnet passphrase with mainnet RPC — mismatch
  if (isTestnet && rpcUrl === MAINNET_ARTIFACTS.rpcUrl) {
    throw new SubRosaNetworkMismatchError(
      `networkPassphrase "${STELLAR_TESTNET_PASSPHRASE}" is the Stellar testnet passphrase, ` +
        `but rpcUrl "${rpcUrl}" points to the Stellar mainnet. ` +
        `Use "${STELLAR_PUBLIC_PASSPHRASE}" for mainnet, or supply a custom passphrase for local networks.`,
    );
  }

  // Public/mainnet passphrase with non-mainnet RPC — mismatch
  if (isPublic && rpcUrl !== MAINNET_ARTIFACTS.rpcUrl) {
    throw new SubRosaNetworkMismatchError(
      `networkPassphrase "${STELLAR_PUBLIC_PASSPHRASE}" is the Stellar Public Network passphrase, ` +
        `but rpcUrl "${rpcUrl}" does not match the expected mainnet RPC URL "${MAINNET_ARTIFACTS.rpcUrl}". ` +
        `Use "${STELLAR_TESTNET_PASSPHRASE}" for testnet, or supply a custom passphrase for local networks.`,
    );
  }
}
