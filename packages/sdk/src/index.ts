export {
  SubRosaClient,
  type SubRosaClientConfig,
  type CreateRoundParams,
  type CommitParams,
  type RevealParams,
  type ClearingRuleTag,
} from "./client.js";
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
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaPreflightError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
export type {
  PreflightFailureKind,
  SubRosaPreflightErrorParams,
  TimeoutErrorParams,
} from "./errors.js";
export { MAINNET_ARTIFACTS, MAINNET_MICRO_MAX_ESCROW } from "./mainnet-artifacts.js";

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
