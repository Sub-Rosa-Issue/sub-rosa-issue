// Copyright (c) 2026 Sub Rosa contributors
export {
  commitment,
  commitmentMatches,
  encodeBidPreimage,
  decodeBidPreimage,
  i128ToBeBytes,
  beBytesToI128,
  toHex,
  fromHex,
  isValidHex,
  VALUE_BYTES,
  NONCE_BYTES,
  PREIMAGE_BYTES,
  COMMITMENT_BYTES,
} from "./commitment.js";

export {
  parseSealedPayload,
  isSealedBidPayload,
  ARMOR_LINE_WIDTH,
  TLOCK_ARMOR_HEADER,
  TLOCK_ARMOR_FOOTER,
  AGE_VERSION,
  TLOCK_STANZA_TYPE,
  SEALED_BID_PLAINTEXT_BYTES,
  type SealedPayloadHeader,
  type SealedPayloadParse,
  type SealedPayloadRejection,
} from "./ciphertext.js";

export {
  generateAuditorKeypair,
  auditorPublicKey,
  sealIdentity,
  openIdentity,
  sealIdentityForBidder,
  openIdentityForBidder,
  decodeIdentityBlob,
  isIdentityBound,
  IdentityBindingError,
  IDENTITY_BLOB_VERSION,
  type AuditorKeypair,
  type SealIdentityForBidderParams,
  type OpenIdentityForBidderParams,
  type OpenedIdentity,
} from "./auditor.js";

export {
  quicknet,
  chainInfo,
  currentRound,
  roundInSeconds,
  fetchRoundBeacon,
  fetchRoundSignature,
  QUICKNET_HASH,
  QUICKNET_GENESIS,
  QUICKNET_PERIOD,
  QUICKNET_FIXTURE,
  assertQuicknetFixture,
  type DrandClient,
} from "./quicknet.js";

export { drandSignatureToSoroban, encodeG1Soroban } from "./bls.js";

export {
  assertChainInfo,
  assertBeacon,
  type RawChainInfo,
  type RawBeacon,
} from "./validate.js";

export {
  sealBid,
  openBid,
  generateNonce,
  type SealBidParams,
  type SealedBid,
  type OpenedBid,
} from "./seal.js";

export {
  computePublishAtMs,
  classifyDrandRound,
  DEFAULT_STALE_THRESHOLD_MS,
  type DrandRoundInfo,
  type FreshnessStatus,
  type FreshnessResult,
} from "./freshness.js";

export {
  assertSealRoundWindow,
  isMalformedRound,
  SealRoundError,
  type SealRoundErrorReason,
} from "./window.js";

export {
  encodePayloadEnvelope,
  decodePayloadEnvelope,
  payloadCommitment,
  sealPayload,
  openPayload,
  PAYLOAD_ENVELOPE_VERSION,
  PAYLOAD_HEADER_BYTES,
  MAX_APPLICATION_PAYLOAD_BYTES,
  type PayloadEnvelope,
  type SealPayloadParams,
  type SealedPayload,
} from "./payload.js";
