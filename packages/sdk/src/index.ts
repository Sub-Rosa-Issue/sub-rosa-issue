// SPDX-License-Identifier: MIT
export {
  SubRosaClient,
  type SubRosaClientConfig,
  type CreateRoundParams,
  type CommitParams,
  type RevealParams,
  type ClearingRuleTag,
} from "./client.js";
export { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
export {
  submissionKey,
  type SubmissionIdentity,
  type SubmissionJournal,
  type SubmissionRecord,
  type SubmissionState,
} from "./submission.js";
export {
  type PreflightOperation,
  type PreflightResult,
  type PreflightSuccess,
  type PreflightFailureResult,
  type PreflightFeeEstimate,
  type PreflightResourceEstimate,
  evaluatePreflight,
  contractErrorCode,
} from "./preflight.js";
export {
  createOzChannelsSubmitter,
  createOzChannelsSubmitterFromEnv,
  type OzChannelsSubmitterConfig,
  type SubmittedTransaction,
  type SubmitSignedTransactionParams,
  type TransactionSubmitter,
} from "./submitter.js";
export {
  ROUND_CONTRACT_ERRORS,
  ROUND_CONTRACT_ERRORS_BY_NAME,
  getRoundContractError,
  isRoundContractErrorRetryable,
  diffContractErrorMapping,
  SubRosaClientConfigError,
  SubRosaDeploymentMismatchError,
  SubRosaManifestError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaPreflightError,
  SubRosaSessionMismatchError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
  SubRosaAssetValidationError,
} from "./errors.js";
export type {
  DeploymentMismatchErrorParams,
  ManifestErrorParams,
  NetworkMismatchErrorParams,
  NetworkMismatchReason,
  PreflightFailureKind,
  SubRosaPreflightErrorParams,
  TimeoutErrorParams,
} from "./errors.js";

// Escrow conservation: the off-chain mirror of the contract's
// EscrowNotConserved guard (issue #374).
export {
  ESCROW_MAX_BIDDERS,
  ESCROW_PAGE_SIZE,
  evaluateEscrowConservation,
  isEscrowConserved,
  proveEscrowConservationFromPages,
  type EscrowConservationIssue,
  type EscrowConservationIssueCode,
  type EscrowConservationPhase,
  type EscrowConservationReport,
  type EscrowConservationSource,
  type EscrowConservationTotals,
  type ProveEscrowConservationOptions,
} from "./conservation.js";
export {
  validateContractNetwork,
  validatePasskeySession,
  type ContractNetworkValidationConfig,
  type NetworkValidationServer,
  type PasskeySessionBinding,
  type SessionBindingTarget,
} from "./network.js";

export {
  validateEncryptedBlob,
  validateSealedBid,
  assertSealedBid,
  tryDecodeHex,
  tryDecodeBase64,
  MAX_CIPHERTEXT_BYTES,
  MAX_AUDITOR_BLOB_BYTES,
  type BlobContentType,
  type BlobValidationIssue,
  type BlobValidationResult,
  type SealedBidBinding,
} from "./encrypted-blob.js";
export {
  DEPLOYMENT_CHECK_IDS,
  DEPLOYMENT_FIELDS,
  DEPLOYMENT_FIELD_LABELS,
  MAINNET_ARTIFACTS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_DEPLOY_MIN_XLM_STROOPS,
  MAINNET_MANIFEST,
  MAINNET_MANIFEST_PATH,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_MIN_FEE_RESERVE_STROOPS,
  MAINNET_XLM_SAC_ID,
  parseMainnetManifest,
  type DeploymentField,
  type MainnetManifest,
} from "./mainnet-artifacts.js";
export {
  AssetConfigError,
  validateAssetConfig,
  validateAssetConfigs,
  ASSET_FIXTURES,
  type AssetConfig,
  type AssetType,
} from "./asset-config.js";
export {
  assertDeploymentMatches,
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  compareDeployment,
  createSacBalanceReader,
  defaultMainnetReadinessInput,
  deploymentChecks,
  fetchContractWasmHash,
  fixtureDeployment,
  fixtureReader,
  formatReadinessReport,
  hasBlockingFailures,
  nativeXlmSacId,
  parseMainnetReadinessFixture,
  readLiveDeployment,
  runMainnetReadiness,
  summarizeDeploymentValue,
  verifySettledRoundProof,
  type DeploymentComparison,
  type DeploymentFieldComparison,
  type MainnetFixtureBid,
  type MainnetFixtureRound,
  type MainnetLiveDeployment,
  type MainnetReadinessDeps,
  type MainnetReadinessFixture,
  type MainnetReadinessInput,
  type MainnetReadinessReport,
  type ReadinessCheck,
  type ReadinessReader,
  type ReadinessStatus,
} from "./mainnet-readiness.js";

export {
  serializeReceipt,
  parseReceipt,
  networkFingerprint,
  type RoundReceipt,
  type RoundReceiptEvent,
  type BidReceiptEntry,
  RECEIPT_VERSION,
} from "./receipt.js";
export {
  redactReceipt,
  type RedactOptions,
} from "./redact.js";
export {
  verifyReceiptEvents,
  RECEIPT_EVENT_ERROR_CODES,
  type ReceiptEventIssue,
  type ReceiptEventErrorCode,
  type ReceiptEventsVerifyOptions,
  type ReceiptEventsVerifyResult,
} from "./receipt-events.js";
export {
  verifyReceipt,
  type VerificationIssue,
  type VerificationResult,
  type VerifyOptions,
  type Severity,
} from "./verify.js";

// Round-status predicates and human-readable labels. Mirror
// services/keeper/src/status.ts status vocab.
export {
  ACTIVE_ROUND_STATUSES,
  TERMINAL_ROUND_STATUSES,
  ERROR_ROUND_STATUSES,
  type RoundStatusClass,
  classifyRoundStatus,
  isActiveRoundStatus,
  isTerminalRoundStatus,
  isErrorRoundStatus,
  roundStatusLabel,
  type RoundPhase,
  ROUND_PHASES,
  ROUND_PHASE_LABELS,
  roundPhaseLabel,
  isRoundPhase,
  isKeeperRoundActive,
  isKeeperRoundTerminal,
  isKeeperRoundSettlementPending,
} from "./round-status.js";

// Keeper status-API response shapes. Mirror services/keeper/src/status.ts.
export {
  type RoundStatus,
  type SettlementIndicator,
  type KeeperHealthState,
  type KeeperRoundStatusView,
  type KeeperServiceHealth,
  type KeeperStatusResponse,
  type KeeperHealthResponse,
  type ApiError,
  type DashboardPhase,
  type DashboardSnapshot,
} from "./status.js";

// Fetch client for the keeper status API.
export {
  KeeperStatusClient,
  StatusApiError,
  StatusJsonParseError,
  KeeperStatusTimeoutError,
  redactUrlUserinfo,
  type KeeperReadiness,
  type KeeperNotReadyReason,
  type StatusClientOptions,
  fetchKeeperStatus,
} from "./status-client.js";

// Canonical Round contract event surface (generated-bindings event snapshot
// + lifecycle ordering), re-exported so consumers read the event knowledge
// from the bindings package rather than restating it.
export {
  expectedRoundEventSequence,
  ROUND_EVENT_LIFECYCLE_ORDER,
  ROUND_EVENT_PHASE_BY_NAME,
  ROUND_EVENT_PHASE_RANK,
} from "@sub-rosa/round-bindings/event-snapshot";

// Re-export the generated contract types so consumers get spec-accurate shapes
// from a single import surface.
export {
  Client as RoundContract,
  Errors as RoundErrors,
  type Round,
  type BidState,
  type BiddersPage,
  type Seal,
  type GlobalConfig,
  type ClearingRule,
  type Status,
  type DataKey,
} from "@sub-rosa/round-bindings";
