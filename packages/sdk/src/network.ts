import { Contract, rpc } from "@stellar/stellar-sdk";
import { systemScheduler, type Scheduler } from "@sub-rosa/time";
import {
  SubRosaClientConfigError,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
} from "./errors.js";
import { normalizeSorobanContractId } from "./ids.js";

/** Shared default timeout (ms) for external RPC, keeper, appraisal, and Drand requests. */
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

/** Raised when an external RPC or HTTP request exceeds its configured timeout. */
export class SubRosaRpcRequestTimeoutError extends Error {
  readonly name = "SubRosaRpcRequestTimeoutError";
  readonly timeoutMs: number;

  constructor(timeoutMs: number, label = "RPC request") {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

/** Validate an optional RPC timeout (ms), defaulting to {@link DEFAULT_RPC_TIMEOUT_MS}. */
export function assertRpcTimeoutMs(
  timeoutMs: number | undefined,
  label = "rpcTimeoutMs",
): number {
  const resolved = timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new SubRosaClientConfigError(
      `${label} must be a positive finite number of milliseconds, got ${timeoutMs}`,
    );
  }
  return resolved;
}

export interface BoundedTimeoutOptions {
  timeoutMs?: number;
  scheduler?: Scheduler;
  signal?: AbortSignal;
  label?: string;
}

/**
 * Bound an asynchronous external RPC/HTTP operation with a single timeout
 * (defaulting to {@link DEFAULT_RPC_TIMEOUT_MS}).
 */
export async function withBoundedTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: BoundedTimeoutOptions = {},
): Promise<T> {
  const timeoutMs = assertRpcTimeoutMs(options.timeoutMs);
  const scheduler = options.scheduler ?? systemScheduler;
  const label = options.label ?? "RPC request";
  const controller = new AbortController();
  const timeoutError = new SubRosaRpcRequestTimeoutError(timeoutMs, label);

  let onTimeout!: () => void;
  const timedOut = new Promise<never>((_resolve, reject) => {
    onTimeout = () => {
      controller.abort(timeoutError);
      reject(timeoutError);
    };
  });

  const timer = scheduler.setTimeout(onTimeout, timeoutMs);
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    scheduler.clear(timer);
    throw options.signal.reason ?? new Error("Request aborted");
  }
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  let pending: Promise<T>;
  try {
    pending = Promise.resolve(operation(controller.signal));
  } catch (err) {
    scheduler.clear(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
    throw err;
  }
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    scheduler.clear(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
    pending.catch(() => {});
  }
}

export interface BoundedFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  scheduler?: Scheduler;
  label?: string;
}

/** Wrap a `fetch` implementation so every request is bounded by one timeout. */
export function createBoundedFetch(
  options: BoundedFetchOptions = {},
): typeof fetch {
  const timeoutMs = assertRpcTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const scheduler = options.scheduler ?? systemScheduler;
  const label = options.label ?? "RPC request";

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    withBoundedTimeout(
      (signal) => fetchImpl(input, { ...init, signal }),
      {
        timeoutMs,
        scheduler,
        signal: init?.signal ?? undefined,
        label,
      },
    );
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

