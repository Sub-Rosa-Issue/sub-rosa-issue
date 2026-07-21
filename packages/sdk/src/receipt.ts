// Canonical round receipt — deterministic, versioned, offline-verifiable.
//
// Every bigint is serialized as a decimal string; every byte sequence as
// lowercase hex. Fields that depend on expired Temporary storage (seal
// ciphertext, auditor blob) are honestly marked null when unavailable.

import { createHash } from "node:crypto";
import { SubRosaReceiptValidationError } from "./errors.js";

export const RECEIPT_VERSION = 1;

/** sha256(utf8(networkPassphrase)) — hex. Embedded in the receipt so the
 *  offline verifier can detect a tampered `network` field without any caller-
 *  supplied context. */
export function networkFingerprint(passphrase: string): string {
  return createHash("sha256").update(passphrase, "utf8").digest("hex");
}

export interface BidReceiptEntry {
  /** sha256(be16(value) ‖ nonce) — hex. */
  commitment: string;
  /** Public USDC budget locked at commit — decimal string. */
  escrow: string;
  /** Revealed bid value — decimal string; null if not revealed. */
  revealedValue: string | null;
  /** 32-byte nonce that was combined with the value — hex; null if not revealed. */
  nonce: string | null;
  /** Whether the recomputed sha256 matches the on-chain commitment. null if unrevealed. */
  hashValid: boolean | null;
  /** Whether the bid was marked valid by the contract at clear time. */
  valid: boolean;
  /** Whether this bidder's escrow has been settled/refunded. */
  settled: boolean;
  /** Available ephemeral evidence (may be null if expired). */
  evidence: {
    /** tlock ciphertext — hex; null if expired. */
    ciphertext: string | null;
    /** Encrypted bidder identity — hex; null if expired. */
    auditorBlob: string | null;
  };
}

export interface RoundReceipt {
  /** Schema version. Currently 1. */
  version: typeof RECEIPT_VERSION;
  /** Stellar network passphrase (e.g. "Test SDF Network ; September 2015"). */
  network: string;
  /** sha256(utf8(network)) — hex. Lets the offline verifier detect a tampered
   *  `network` field without any caller-supplied context. */
  networkFingerprint: string;
  /** Contract ID the round belongs to (C…). */
  contractId: string;
  /** ISO-8601 timestamp when this receipt was exported. */
  exportedAt: string;

  // ── Round parameters ───────────────────────────────────────────────
  /** Round ID (u64, decimal string). */
  roundId: string;
  /** Opaque 32-byte item reference — hex. */
  itemRef: string;
  /** Drand round R whose threshold signature unseals the bids. */
  revealRound: number;
  /** Clearing rule tag (e.g. "HighestBid", "LowestBid"). */
  clearingRule: string;
  /** Commit window deadline — Unix seconds (decimal string). */
  commitDeadline: string;
  /** Reveal window deadline — Unix seconds (decimal string). */
  revealDeadline: string;
  /** Operator address (G…). */
  operator: string;
  /** Auditor public key — hex. */
  auditorPubkey: string;

  // ── Participants ───────────────────────────────────────────────────
  /** Ordered bidder addresses, matching the on-chain index order. */
  bidders: string[];
  /** Per-bidder detail keyed by address. */
  bids: Record<string, BidReceiptEntry>;

  // ── Outcome ─────────────────────────────────────────────────────────
  /** Winning bidder address, or null if voided / no valid bids. */
  winner: string | null;
  /** Winning bid value — decimal string, or null. */
  winningValue: string | null;
  /** Final on-chain status tag. */
  status: string;
  /** Optional checksum of the local artifact manifest or binding file. */
  artifactChecksum?: string;
}

function sortKeys(_: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return value;
}

function validationError(message: string, field?: string): never {
  throw new SubRosaReceiptValidationError(message, field);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    validationError(`${field} must be a non-empty string`, field);
  }
}

function assertDecimalString(value: unknown, field: string): void {
  assertNonEmptyString(value, field);
  if (!/^\d+$/.test(value)) {
    validationError(`${field} must be a decimal string`, field);
  }
}

function assertHexString(value: unknown, field: string): void {
  assertNonEmptyString(value, field);
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    validationError(`${field} must be even-length hex`, field);
  }
}

function assertNullableDecimalString(value: unknown, field: string): void {
  if (value === null) return;
  assertDecimalString(value, field);
}

function assertNullableHexString(value: unknown, field: string): void {
  if (value === null) return;
  assertHexString(value, field);
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    validationError(`${field} must be a boolean`, field);
  }
}

function assertNullableBoolean(
  value: unknown,
  field: string,
): asserts value is boolean | null {
  if (value !== null && typeof value !== "boolean") {
    validationError(`${field} must be boolean or null`, field);
  }
}

function validateBidEntry(value: unknown, field: string): BidReceiptEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${field} must be an object`, field);
  }
  const entry = value as Record<string, unknown>;
  assertHexString(entry.commitment, `${field}.commitment`);
  assertDecimalString(entry.escrow, `${field}.escrow`);
  assertNullableDecimalString(entry.revealedValue, `${field}.revealedValue`);
  assertNullableHexString(entry.nonce, `${field}.nonce`);
  assertNullableBoolean(entry.hashValid, `${field}.hashValid`);
  assertBoolean(entry.valid, `${field}.valid`);
  assertBoolean(entry.settled, `${field}.settled`);

  if (
    entry.evidence === null ||
    typeof entry.evidence !== "object" ||
    Array.isArray(entry.evidence)
  ) {
    validationError(`${field}.evidence must be an object`, `${field}.evidence`);
  }
  const evidence = entry.evidence as Record<string, unknown>;
  assertNullableHexString(evidence.ciphertext, `${field}.evidence.ciphertext`);
  assertNullableHexString(evidence.auditorBlob, `${field}.evidence.auditorBlob`);

  return entry as BidReceiptEntry;
}

/** Validate a parsed or in-memory receipt before export/serialize. */
export function validateReceipt(value: unknown): RoundReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    validationError("receipt must be an object");
  }

  const receipt = value as Record<string, unknown>;

  if (receipt.version !== RECEIPT_VERSION) {
    validationError(`version must be ${RECEIPT_VERSION}`, "version");
  }

  assertNonEmptyString(receipt.network, "network");
  assertHexString(receipt.networkFingerprint, "networkFingerprint");
  const expectedFingerprint = networkFingerprint(receipt.network);
  if (receipt.networkFingerprint !== expectedFingerprint) {
    validationError("networkFingerprint does not match network", "networkFingerprint");
  }

  assertNonEmptyString(receipt.contractId, "contractId");
  assertNonEmptyString(receipt.exportedAt, "exportedAt");
  assertDecimalString(receipt.roundId, "roundId");
  assertHexString(receipt.itemRef, "itemRef");

  if (typeof receipt.revealRound !== "number" || !Number.isFinite(receipt.revealRound)) {
    validationError("revealRound must be a finite number", "revealRound");
  }

  assertNonEmptyString(receipt.clearingRule, "clearingRule");
  assertDecimalString(receipt.commitDeadline, "commitDeadline");
  assertDecimalString(receipt.revealDeadline, "revealDeadline");
  assertNonEmptyString(receipt.operator, "operator");
  assertHexString(receipt.auditorPubkey, "auditorPubkey");
  assertNonEmptyString(receipt.status, "status");

  if (!Array.isArray(receipt.bidders)) {
    validationError("bidders must be an array", "bidders");
  }
  for (const [index, bidder] of receipt.bidders.entries()) {
    assertNonEmptyString(bidder, `bidders[${index}]`);
  }

  if (
    receipt.bids === null ||
    typeof receipt.bids !== "object" ||
    Array.isArray(receipt.bids)
  ) {
    validationError("bids must be an object", "bids");
  }

  const bids = receipt.bids as Record<string, unknown>;
  for (const bidder of receipt.bidders as string[]) {
    if (!(bidder in bids)) {
      validationError(`missing bid entry for bidder ${bidder}`, `bids.${bidder}`);
    }
    validateBidEntry(bids[bidder], `bids.${bidder}`);
  }

  if (receipt.winner !== null) {
    assertNonEmptyString(receipt.winner, "winner");
  }
  assertNullableDecimalString(receipt.winningValue, "winningValue");

  if (receipt.artifactChecksum !== undefined) {
    assertNonEmptyString(receipt.artifactChecksum, "artifactChecksum");
  }

  return receipt as RoundReceipt;
}

/** Serialise a receipt to canonical JSON (deep-sorted keys, no whitespace).
 *  This is the format the CLI writes and the verifier reads. */
export function serializeReceipt(receipt: RoundReceipt): string {
  validateReceipt(receipt);
  return JSON.stringify(receipt, sortKeys) + "\n";
}

/** Parse a receipt from its canonical JSON form. */
export function parseReceipt(json: string): RoundReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SubRosaReceiptValidationError("receipt JSON is invalid", undefined, {
      cause: error,
    });
  }
  return validateReceipt(parsed);
}
