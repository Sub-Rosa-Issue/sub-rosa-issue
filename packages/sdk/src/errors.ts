// SPDX-License-Identifier: MIT
import { StatusApiError, StatusJsonParseError } from "./status-client.js";
import type {
  EscrowConservationPhase,
  EscrowConservationReport,
} from "./conservation.js";

export class SubRosaClientConfigError extends Error {
  readonly name = "SubRosaClientConfigError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type NetworkMismatchReason =
  | "passphrase"
  | "contract_not_found"
  | "contract_mismatch"
  | "account_mismatch"
  | "session_mismatch";

export interface NetworkMismatchErrorParams {
  contractId: string;
  configuredPassphrase: string;
  rpcPassphrase?: string;
  rpcUrl?: string;
  reason: NetworkMismatchReason;
  sessionContractId?: string;
  sessionPassphrase?: string;
  sessionAccount?: string;
  expectedAccount?: string;
}

/** Raised before contract simulation/signing when network configuration or session binding conflicts. */
export class SubRosaNetworkMismatchError extends Error {
  readonly name: string = "SubRosaNetworkMismatchError";
  readonly contractId: string;
  readonly configuredPassphrase: string;
  readonly rpcPassphrase?: string;
  readonly rpcUrl?: string;
  readonly reason: NetworkMismatchErrorParams["reason"];
  readonly sessionContractId?: string;
  readonly sessionPassphrase?: string;
  readonly sessionAccount?: string;
  readonly expectedAccount?: string;

  constructor(params: NetworkMismatchErrorParams) {
    let rawMessage: string;
    if (params.reason === "passphrase") {
      rawMessage = `networkPassphrase ${JSON.stringify(params.configuredPassphrase)} does not match RPC network ${JSON.stringify(params.rpcPassphrase)} at ${params.rpcUrl}; use the passphrase and contract ID from the same deployment`;
    } else if (params.reason === "contract_not_found") {
      rawMessage = `contract ${params.contractId} was not found on RPC network ${JSON.stringify(params.rpcPassphrase)} at ${params.rpcUrl}; check that contractId and networkPassphrase refer to the same deployment`;
    } else if (params.reason === "contract_mismatch") {
      rawMessage = `passkey session contract ${params.sessionContractId ?? params.contractId} does not match client contract ${params.contractId}; refuse commit across different contracts`;
    } else if (params.reason === "account_mismatch") {
      rawMessage = `passkey session account ${params.sessionAccount} does not match client account ${params.expectedAccount}; refuse commit for different account`;
    } else {
      rawMessage = `passkey session network ${JSON.stringify(params.sessionPassphrase ?? params.configuredPassphrase)} does not match client network ${JSON.stringify(params.configuredPassphrase)}; refuse commit across different networks`;
    }

    // Keep secret seeds strictly out of error text
    const message = rawMessage.replace(/\bS[A-Z2-7]{55}\b/g, "[REDACTED]");
    super(message);
    this.contractId = params.contractId;
    this.configuredPassphrase = params.configuredPassphrase;
    this.rpcPassphrase = params.rpcPassphrase;
    this.rpcUrl = params.rpcUrl;
    this.reason = params.reason;
    this.sessionContractId = params.sessionContractId;
    this.sessionPassphrase = params.sessionPassphrase;
    this.sessionAccount = params.sessionAccount;
    this.expectedAccount = params.expectedAccount;
  }
}

/** Specific typed error for passkey session binding mismatches. Inherits from SubRosaNetworkMismatchError. */
export class SubRosaSessionMismatchError extends SubRosaNetworkMismatchError {
  override readonly name = "SubRosaSessionMismatchError";
}

export class SubRosaSubmitError extends Error {
  readonly name = "SubRosaSubmitError";
  readonly retryable?: boolean;

  constructor(message: string, options?: ErrorOptions & { retryable?: boolean }) {
    super(message, options);
    if (options?.retryable !== undefined) {
      this.retryable = options.retryable;
    }
  }
}

export class SubRosaTransactionError extends Error {
  readonly name = "SubRosaTransactionError";
  readonly hash: string;
  readonly status: string;
  readonly retryable?: boolean;

  constructor(hash: string, status: string, options?: ErrorOptions & { retryable?: boolean }) {
    super(`transaction ${hash} ended with status ${status}`, options);
    this.hash = hash;
    this.status = status;
    if (options?.retryable !== undefined) {
      this.retryable = options.retryable;
    }
  }
}

export class SubRosaMissingReturnValueError extends Error {
  readonly name = "SubRosaMissingReturnValueError";
  readonly hash: string;

  constructor(hash: string) {
    super(`transaction ${hash} succeeded without a return value`);
    this.hash = hash;
  }
}

export interface TimeoutErrorParams {
  hash: string;
  submitter: string;
  lastStatus: string;
  timeoutMs: number;
  pollIntervalMs: number;
}


export class SubRosaAssetValidationError extends Error {
  readonly name = "SubRosaAssetValidationError";

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

export type PreflightFailureKind =
  | "rpc_error"
  | "simulation_error"
  | "expired_state"
  | "contract_error"
  | "malformed_response"
  | "escrow_not_conserved";

export interface SubRosaPreflightErrorParams {
  kind: PreflightFailureKind;
  operation: string;
  message: string;
  simulationError?: string;
  contractErrorCode?: number;
  contractErrorMessage?: string;
  restoreMinResourceFee?: bigint;
  retryable?: boolean;
  cause?: unknown;
}

/** Typed error for preflight/simulation failures before transaction submission. */
export class SubRosaPreflightError extends Error {
  readonly name = "SubRosaPreflightError";
  readonly kind: PreflightFailureKind;
  readonly operation: string;
  readonly simulationError?: string;
  readonly contractErrorCode?: number;
  readonly contractErrorMessage?: string;
  readonly restoreMinResourceFee?: bigint;
  readonly retryable: boolean;

  constructor(params: SubRosaPreflightErrorParams) {
    super(params.message, params.cause ? { cause: params.cause } : undefined);
    this.kind = params.kind;
    this.operation = params.operation;
    this.simulationError = params.simulationError;
    this.contractErrorCode = params.contractErrorCode;
    this.contractErrorMessage = params.contractErrorMessage;
    this.restoreMinResourceFee = params.restoreMinResourceFee;
    this.retryable =
      params.retryable ??
      (params.kind === "contract_error"
        ? isRoundContractErrorRetryable(params.contractErrorCode ?? params.contractErrorMessage)
        : false);
  }
}

export interface EscrowConservationErrorParams {
  roundId: bigint;
  /** The operation whose escrow accounting failed to balance. */
  phase: EscrowConservationPhase;
  report: EscrowConservationReport;
  cause?: unknown;
}

/**
 * Typed error for a round whose escrow does not reconcile before payout.
 *
 * The Round contract refuses to `settle` or `void` such a round with
 * `EscrowNotConserved`; this error is the off-chain equivalent, raised before
 * any transaction is built, so a keeper can halt instead of burning a fee.
 */
export class SubRosaEscrowConservationError extends SubRosaPreflightError {
  readonly roundId: bigint;
  readonly phase: EscrowConservationPhase;
  readonly report: EscrowConservationReport;

  constructor(params: EscrowConservationErrorParams) {
    const stranded = params.report.stranded;
    const summary = params.report.issues
      .slice(0, 3)
      .map((i) => i.message)
      .join("; ");
    super({
      kind: "escrow_not_conserved",
      operation: params.phase,
      message:
        `round ${params.roundId} does not conserve escrow before ${params.phase}: ` +
        `held ${params.report.escrowHeld}, pays ${params.report.payable}, ` +
        `refunds ${params.report.refundable}, strands ${stranded}` +
        (summary ? ` (${summary})` : ""),
      cause: params.cause,
    });
    this.roundId = params.roundId;
    this.phase = params.phase;
    this.report = params.report;
  }
}

export interface ManifestErrorParams {
  message: string;
  /** Manifest field that failed validation, when the failure is field-scoped. */
  field?: string;
  /** Path of the committed manifest file, when it was read from disk. */
  path?: string;
  cause?: unknown;
}

/** Raised when the committed artifact manifest is missing, unreadable, or invalid. */
export class SubRosaManifestError extends Error {
  readonly name = "SubRosaManifestError";
  readonly field?: string;
  readonly path?: string;

  constructor(message: string, params: Omit<ManifestErrorParams, "message"> = {}) {
    super(message, params.cause === undefined ? undefined : { cause: params.cause });
    this.field = params.field;
    this.path = params.path;
  }
}

export interface DeploymentMismatchErrorParams {
  /** Manifest field names that disagreed, in manifest order. */
  fields: string[];
  /** One redacted, human-readable line per field. */
  details: string[];
  /** Source of the expectations, e.g. the manifest path. */
  manifestSource?: string;
}

/**
 * Raised when the live deployment disagrees with the committed manifest. The
 * message names the offending fields and carries only redacted values, so it is
 * safe to log.
 */
export class SubRosaDeploymentMismatchError extends Error {
  readonly name = "SubRosaDeploymentMismatchError";
  readonly fields: string[];
  readonly details: string[];
  readonly manifestSource?: string;

  constructor(params: DeploymentMismatchErrorParams) {
    super(
      `deployment does not match the committed mainnet manifest: ${params.fields.join(", ")}` +
        (params.manifestSource ? ` (${params.manifestSource})` : ""),
    );
    this.fields = params.fields;
    this.details = params.details;
    this.manifestSource = params.manifestSource;
  }
}

export class SubRosaTimeoutError extends Error {
  readonly name = "SubRosaTimeoutError";
  readonly hash: string;
  readonly submitter: string;
  readonly lastStatus: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;

  constructor(params: TimeoutErrorParams) {
    super(
      `${params.submitter} submitted ${params.hash}, but RPC did not finalize it in time (last=${params.lastStatus})`,
    );
    this.hash = params.hash;
    this.submitter = params.submitter;
    this.lastStatus = params.lastStatus;
    this.timeoutMs = params.timeoutMs;
    this.pollIntervalMs = params.pollIntervalMs;
  }
}

/**
 * Stable, machine-readable codes for SDK failures. The set is closed, so a
 * code is safe to render at a UI boundary: it never carries a message, a
 * round payload, or any bid data.
 */
export const SDK_ERROR_CODES = [
  "CLIENT_CONFIG",
  "NETWORK_MISMATCH",
  "SUBMIT_FAILED",
  "TRANSACTION_FAILED",
  "MISSING_RETURN_VALUE",
  "PREFLIGHT_FAILED",
  "TRANSACTION_TIMEOUT",
  "STATUS_API_ERROR",
  "STATUS_INVALID_RESPONSE",
  "UNKNOWN",
] as const;

export type SdkErrorCode = (typeof SDK_ERROR_CODES)[number];

/**
 * Map a thrown value to its SDK error code. Classification is by error class
 * only -- properties on the value (including any `code` it carries) are never
 * read, so untrusted errors cannot choose what gets displayed. Anything the
 * SDK did not raise maps to "UNKNOWN".
 */
export function sdkErrorCode(error: unknown): SdkErrorCode {
  if (error instanceof SubRosaClientConfigError) return "CLIENT_CONFIG";
  if (error instanceof SubRosaNetworkMismatchError) return "NETWORK_MISMATCH";
  if (error instanceof SubRosaSubmitError) return "SUBMIT_FAILED";
  if (error instanceof SubRosaTransactionError) return "TRANSACTION_FAILED";
  if (error instanceof SubRosaMissingReturnValueError) return "MISSING_RETURN_VALUE";
  if (error instanceof SubRosaPreflightError) return "PREFLIGHT_FAILED";
  if (error instanceof SubRosaTimeoutError) return "TRANSACTION_TIMEOUT";
  if (error instanceof StatusApiError) return "STATUS_API_ERROR";
  if (error instanceof StatusJsonParseError) return "STATUS_INVALID_RESPONSE";
  return "UNKNOWN";
}
