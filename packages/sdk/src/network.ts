import { Contract, Networks, rpc } from "@stellar/stellar-sdk";
import {
  SubRosaClientConfigError,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
} from "./errors.js";
import { normalizeSorobanContractId } from "./ids.js";

/**
 * Return true when `rawUrl` parses as a URL with a non-empty `username` or
 * `password` component (or contains an authority `@` before the path).
 */
export function hasUrlCredentials(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/\s?#]*@/i.test(trimmed);
  }
}

/**
 * Validate that an RPC or service endpoint URL uses HTTP(S) and does not embed
 * a `username` or `password`. Throws {@link SubRosaClientConfigError} without
 * echoing any credential fragments.
 */
export function assertNoUrlCredentials(
  rawUrl: string,
  label = "rpcUrl",
): URL {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    throw new SubRosaClientConfigError(`${label}: must be a non-empty HTTP or HTTPS URL`);
  }
  if (hasUrlCredentials(trimmed)) {
    throw new SubRosaClientConfigError(`${label}: must not contain credentials`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SubRosaClientConfigError(`${label}: must be a valid HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SubRosaClientConfigError(`${label}: must use http:// or https://`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SubRosaClientConfigError(`${label}: must not contain credentials`);
  }
  return parsed;
}

/**
 * Stellar mainnet passphrase. Traffic on this network must never be sent over
 * plaintext HTTP: the RPC sees the signed envelopes and the Drand endpoint is
 * what decides when a seal opens.
 */
export const MAINNET_NETWORK_PASSPHRASE = Networks.PUBLIC;

/** True when `passphrase` is the Stellar mainnet passphrase (trimmed). */
export function isMainnetPassphrase(passphrase: string): boolean {
  return typeof passphrase === "string" && passphrase.trim() === Networks.PUBLIC;
}

/**
 * True when `rawUrl` points at a loopback host (`localhost`, `127.0.0.0/8`,
 * `::1`, `0.0.0.0`, or a `*.localhost` name). Loopback HTTP stays available for
 * local development; remote plaintext endpoints do not.
 */
export function isLoopbackHost(rawUrl: string | URL): boolean {
  let hostname: string;
  if (rawUrl instanceof URL) {
    hostname = rawUrl.hostname;
  } else {
    try {
      hostname = new URL(rawUrl.trim()).hostname;
    } catch {
      return false;
    }
  }
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".localhost")) return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export interface EndpointTransportSecurityOptions {
  /** Field name used in the error message. Default: "rpcUrl". */
  label?: string;
  /** Passphrase of the network the endpoint serves. */
  networkPassphrase?: string;
  /** Explicit opt-in to HTTP for local/testnet development. */
  allowHttp?: boolean;
}

/**
 * Validate an RPC (or other service) endpoint URL and its transport security.
 *
 * - HTTPS is always accepted.
 * - On mainnet, HTTP is rejected outright — even with `allowHttp: true` and
 *   even for loopback hosts — because there is no development node that could
 *   legitimately serve mainnet state over plaintext.
 * - Off mainnet, HTTP requires an explicit `allowHttp: true`.
 *
 * Credentials embedded in the URL are rejected before anything else so they can
 * never be echoed back.
 */
export function assertEndpointTransportSecurity(
  rawUrl: string,
  options: EndpointTransportSecurityOptions = {},
): URL {
  const label = options.label ?? "rpcUrl";
  const parsed = assertNoUrlCredentials(rawUrl, label);
  if (parsed.protocol === "https:") return parsed;

  if (isMainnetPassphrase(options.networkPassphrase ?? "")) {
    throw new SubRosaClientConfigError(
      `${label} must use https on mainnet; allowHttp only applies to local/testnet development`,
    );
  }
  if (!options.allowHttp) {
    throw new SubRosaClientConfigError(
      `${label} must use https unless allowHttp is explicitly enabled`,
    );
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

