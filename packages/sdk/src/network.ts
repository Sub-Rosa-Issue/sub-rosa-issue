import { Contract, rpc } from "@stellar/stellar-sdk";
import {
  SubRosaClientConfigError,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
} from "./errors.js";
import { normalizeSorobanContractId } from "./ids.js";

/** True when `passphrase` identifies Stellar Public (Mainnet). */
export function isMainnetPassphrase(passphrase: string): boolean {
  return networkDisplayName(passphrase) === "Public";
}

/** True when `hostname` is a loopback address (`localhost`, `127.0.0.1`, `[::1]`). */
export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

export interface EndpointTransportSecurityOptions {
  /** Stellar network passphrase. Mainnet passphrases always require `https://`. */
  networkPassphrase?: string;
  /** Explicit opt-in for `http://` on non-mainnet development/test networks. */
  allowHttp?: boolean;
  /** Field or env-var label used in error messages. Default: `"rpcUrl"`. */
  label?: string;
}

/**
 * Enforce transport security on an RPC or service endpoint URL:
 * - Mainnet (`Public Global Stellar Network ; September 2015`) ALWAYS requires `https://`,
 *   even if `allowHttp` is set or the host is loopback.
 * - Non-mainnet networks require `https://` unless `allowHttp: true` is explicitly set.
 */
export function assertEndpointTransportSecurity(
  rawUrl: string,
  options: EndpointTransportSecurityOptions = {},
): URL {
  const label = options.label ?? "rpcUrl";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (cause) {
    throw new SubRosaClientConfigError(
      `${label} must be a valid HTTP(S) URL`,
      { cause },
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SubRosaClientConfigError(
      `${label} must use https:// or http:// (got ${parsed.protocol})`,
    );
  }

  if (parsed.protocol === "http:") {
    if (
      options.networkPassphrase !== undefined &&
      isMainnetPassphrase(options.networkPassphrase)
    ) {
      throw new SubRosaClientConfigError(
        `${label} must use https:// when configured for mainnet`,
      );
    }
    if (!options.allowHttp) {
      throw new SubRosaClientConfigError(
        `${label} must use https unless allowHttp is explicitly enabled`,
      );
    }
  }

  return parsed;
}


/**
 * Human-readable label for a Stellar network passphrase. Unknown/custom
 * networks fall back to the passphrase itself so the caller still sees which
 * network it is (never a secret).
 */
export function networkDisplayName(passphrase: string): string {
  const trimmed = passphrase.trim();
  if (trimmed === "") return "an unknown network";
  if (trimmed.includes("Public")) return "Public";
  if (trimmed.includes("Future")) return "Futurenet";
  if (trimmed.includes("Test SDF") || /^Test\b/.test(trimmed)) return "Testnet";
  if (trimmed.includes("Standalone") || trimmed.includes("Local")) return "Standalone";
  return trimmed;
}

/** True when both passphrases refer to the same network (after trimming). */
export function networkPassphrasesMatch(
  chainPassphrase: string,
  sdkPassphrase: string,
): boolean {
  return chainPassphrase.trim() === sdkPassphrase.trim();
}

/**
 * Message that names both networks so the operator knows which wallet switch
 * to make. Contains only network labels — no secret keys or signed envelopes.
 */
export function describeNetworkPassphraseMismatch(
  chainPassphrase: string,
  sdkPassphrase: string,
): string {
  return (
    `network passphrase mismatch: the connected chain is on ` +
    `"${networkDisplayName(chainPassphrase)}" but the SDK client is configured for ` +
    `"${networkDisplayName(sdkPassphrase)}"`
  );
}

/**
 * Raised before signing/submitting when the connected chain's passphrase
 * differs from the one the SDK client was configured with. Carries both
 * network labels so callers can surface them without exposing a secret or a
 * signed XDR.
 */
export class SubRosaNetworkPassphraseMismatchError extends Error {
  readonly name = "SubRosaNetworkPassphraseMismatchError";
  readonly chainPassphrase: string;
  readonly sdkPassphrase: string;
  readonly chainNetwork: string;
  readonly sdkNetwork: string;

  constructor(chainPassphrase: string, sdkPassphrase: string) {
    super(describeNetworkPassphraseMismatch(chainPassphrase, sdkPassphrase));
    this.chainPassphrase = chainPassphrase;
    this.sdkPassphrase = sdkPassphrase;
    this.chainNetwork = networkDisplayName(chainPassphrase);
    this.sdkNetwork = networkDisplayName(sdkPassphrase);
  }
}

export type NetworkValidationServer = Pick<
  rpc.Server,
  "getNetwork" | "getLedgerEntries"
>;

export interface ContractNetworkValidationConfig {
  networkPassphrase: string;
  contractId: string;
  rpcUrl: string;
}

export interface PasskeySessionBinding {
  /** Contract ID the passkey session was started for. */
  contractId: string;
  /** Network passphrase the passkey session was created on. */
  networkPassphrase: string;
  /** Account/public key bound to this session. */
  account?: string;
}

export interface SessionBindingTarget {
  /** Target contract ID (e.g., from the SDK client). */
  contractId: string;
  /** Target network passphrase (e.g., from the SDK client). */
  networkPassphrase: string;
  /** Target account (e.g., from the SDK client). */
  account?: string;
}

/**
 * Validate that a passkey session matches the contract ID, network passphrase,
 * and account of the executing SDK client.
 *
 * Refuses execution and throws SubRosaSessionMismatchError if any differ.
 */
export function validatePasskeySession(
  session: PasskeySessionBinding,
  target: SessionBindingTarget,
): void {
  if (session.networkPassphrase !== target.networkPassphrase) {
    throw new SubRosaSessionMismatchError({
      contractId: target.contractId,
      configuredPassphrase: target.networkPassphrase,
      sessionPassphrase: session.networkPassphrase,
      reason: "session_mismatch",
    });
  }

  let sessionContract = session.contractId.trim();
  let targetContract = target.contractId.trim();
  try {
    sessionContract = normalizeSorobanContractId(session.contractId);
  } catch {
    // Keep trimmed string
  }
  try {
    targetContract = normalizeSorobanContractId(target.contractId);
  } catch {
    // Keep trimmed string
  }

  if (sessionContract !== targetContract) {
    throw new SubRosaSessionMismatchError({
      contractId: targetContract,
      configuredPassphrase: target.networkPassphrase,
      sessionContractId: sessionContract,
      reason: "contract_mismatch",
    });
  }

  if (session.account && target.account && session.account !== target.account) {
    throw new SubRosaSessionMismatchError({
      contractId: targetContract,
      configuredPassphrase: target.networkPassphrase,
      sessionAccount: session.account,
      expectedAccount: target.account,
      reason: "account_mismatch",
    });
  }
}

/**
 * Confirm that the RPC is on the configured network and that the contract
 * exists there. Contract StrKeys do not encode a network, so both checks are
 * required to catch a contract ID copied from another deployment.
 */
export async function validateContractNetwork(
  server: NetworkValidationServer,
  config: ContractNetworkValidationConfig,
): Promise<void> {
  const network = await server.getNetwork();
  if (network.passphrase !== config.networkPassphrase) {
    throw new SubRosaNetworkMismatchError({
      contractId: config.contractId,
      configuredPassphrase: config.networkPassphrase,
      rpcPassphrase: network.passphrase,
      rpcUrl: config.rpcUrl,
      reason: "passphrase",
    });
  }

  const contractKey = new Contract(config.contractId).getFootprint();
  const response = await server.getLedgerEntries(contractKey);
  if (response.entries.length === 0) {
    throw new SubRosaNetworkMismatchError({
      contractId: config.contractId,
      configuredPassphrase: config.networkPassphrase,
      rpcPassphrase: network.passphrase,
      rpcUrl: config.rpcUrl,
      reason: "contract_not_found",
    });
  }
}

