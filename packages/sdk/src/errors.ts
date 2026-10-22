// SPDX-License-Identifier: MIT
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

export const ROUND_CONTRACT_ERRORS = {
  NotInitialized: 1,
  AlreadyInitialized: 2,
  RoundNotFound: 3,
  BidNotFound: 4,
  CommitClosed: 10,
  CommitNotClosed: 11,
  CommitDeadlineAfterReveal: 12,
  RevealNotOpen: 13,
  RevealAlreadyOpen: 14,
  RevealWindowClosed: 15,
  RevealStillOpen: 16,
  NotCleared: 17,
  AlreadyCleared: 18,
  AlreadySettled: 19,
  RoundVoided: 20,
  NotVoidable: 21,
  WrongStatus: 22,
  InvalidDrandSignature: 30,
  HashMismatch: 31,
  AlreadyRevealed: 32,
  PayloadTooLarge: 33,
  InvalidAmount: 34,
  BidExceedsEscrow: 35,
  DeadlineInPast: 36,
  NoValidBids: 37,
  RoundFull: 38,
  InvalidLimit: 39,
  EscrowNotConserved: 40,
  SealRoundTooEarly: 40,
  SealRoundTooLate: 41,
  InvalidSealRoundZero: 42,
};

export const ROUND_CONTRACT_ERRORS_BY_NAME: Record<string, number> = {
  NotInitialized: 1,
  AlreadyInitialized: 2,
  RoundNotFound: 3,
  BidNotFound: 4,
  CommitClosed: 10,
  CommitNotClosed: 11,
  CommitDeadlineAfterReveal: 12,
  RevealNotOpen: 13,
  RevealAlreadyOpen: 14,
  RevealWindowClosed: 15,
  RevealStillOpen: 16,
  NotCleared: 17,
  AlreadyCleared: 18,
  AlreadySettled: 19,
  RoundVoided: 20,
  NotVoidable: 21,
  WrongStatus: 22,
  InvalidDrandSignature: 30,
  HashMismatch: 31,
  AlreadyRevealed: 32,
  PayloadTooLarge: 33,
  InvalidAmount: 34,
  BidExceedsEscrow: 35,
  DeadlineInPast: 36,
  NoValidBids: 37,
  RoundFull: 38,
  InvalidLimit: 39,
  EscrowNotConserved: 40,
  SealRoundTooEarly: 40,
  SealRoundTooLate: 41,
  InvalidSealRoundZero: 42,
};

export function diffContractErrorMapping(left: { name: string; code: number }[], right?: { name: string; code: number }[]): string[] {
  // TypeScript has issues with Map inference from .map() callbacks; use explicit casts
  const rightByName: Map<string, number> = new Map(
    ((right ?? Object.entries(ROUND_CONTRACT_ERRORS_BY_NAME)) as [string, number][]).map(([name, code]) => [name, code] as [string, number]),
  );
  const leftByName: Map<string, number> = new Map(
    (left as { name: string; code: number }[]).map((v: { name: string; code: number }) => [v.name, v.code] as [string, number])
  );
  /** @type {string[]} */
  const failures: string[] = [];

  for (const [name, code] of leftByName) {
    if (!rightByName.has(name)) {
      failures.push(`${name} (${code}) in left but missing from right`);
      continue;
    }
    const otherCode = rightByName.get(name);
    if (otherCode !== code) {
      failures.push(
        `${name} code mismatch: left=${code}, right=${otherCode}`,
      );
    }
  }

  for (const [name, code] of rightByName) {
    if (!leftByName.has(name)) {
      failures.push(`${name} (${code}) in right but missing from left`);
    }
  }

  return failures;
}

export function getRoundContractError(name: string): { code: number; retryable: boolean } | undefined {
  const code = ROUND_CONTRACT_ERRORS_BY_NAME[name];
  if (code === undefined) {
    return undefined;
  }
  return {
    code,
    retryable: isRoundContractErrorRetryableByName[name],
  };
}

export const isRoundContractErrorRetryableByName: Record<string, boolean> = {
  NotInitialized: false,
  AlreadyInitialized: false,
  RoundNotFound: false,
  BidNotFound: false,
  CommitClosed: false,
  CommitNotClosed: false,
  CommitDeadlineAfterReveal: false,
  RevealNotOpen: false,
  RevealAlreadyOpen: false,
  RevealWindowClosed: false,
  RevealStillOpen: true,
  NotCleared: true,
  AlreadyCleared: false,
  AlreadySettled: false,
  RoundVoided: false,
  NotVoidable: false,
  WrongStatus: false,
  InvalidDrandSignature: false,
  HashMismatch: false,
  AlreadyRevealed: false,
  PayloadTooLarge: false,
  InvalidAmount: false,
  BidExceedsEscrow: false,
  DeadlineInPast: false,
  NoValidBids: false,
  RoundFull: false,
  InvalidLimit: false,
  EscrowNotConserved: false,
  SealRoundTooEarly: false,
  SealRoundTooLate: false,
  InvalidSealRoundZero: false,
};

export function isRoundContractErrorRetryable(codeOrName: number | string | undefined | null): boolean {
  if (codeOrName == null) {
    return false;
  }
  let code: number;
  if (typeof codeOrName === "number") {
    code = codeOrName;
  } else {
    code = ROUND_CONTRACT_ERRORS_BY_NAME[codeOrName];
    if (code === undefined) {
      return false;
    }
  }
  return isRoundContractErrorRetryableByCode[code];
}

export const isRoundContractErrorRetryableByCode: Record<number, boolean> = {
  1: false,
  2: false,
  3: false,
  4: false,
  10: false,
  11: false,
  12: false,
  13: false,
  14: false,
  15: false,
  16: true,
  17: true,
  18: false,
  19: false,
  20: false,
  21: false,
  22: false,
  30: false,
  31: false,
  32: false,
  33: false,
  34: false,
  35: false,
  36: false,
  37: false,
  38: false,
  39: false,
  40: false,
};

export class SubRosaPaginationError extends Error {
  readonly name = "SubRosaPaginationError";
  readonly roundId: bigint;
  readonly bidder?: string;
  readonly reason: string;

  constructor(roundId: number | bigint, code: string, bidder?: string) {
    super(`round ${typeof roundId === "bigint" ? roundId.toString() : String(roundId)} pagination error: ${code}`);
    this.bidder = bidder;
    this.roundId = typeof roundId === "bigint" ? roundId : BigInt(roundId);
    this.reason = code;
  }
}
