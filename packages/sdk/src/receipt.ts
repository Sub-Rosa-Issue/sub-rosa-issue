// SPDX-License-Identifier: MIT
// Canonical round receipt — deterministic, versioned, offline-verifiable.
//
// Every bigint is serialized as a decimal string; every byte sequence as
// lowercase hex. Fields that depend on expired Temporary storage (seal
// ciphertext, auditor blob) are honestly marked null when unavailable.

import { createHash } from "node:crypto";
import type { RoundEventName, RoundEventPhase } from "@sub-rosa/round-bindings/event-snapshot";

export const RECEIPT_VERSION = 1;
export const SUPPORTED_RECEIPT_VERSIONS: readonly number[] = [1];

/** One round-contract event, as recorded from the ledger.
 *
 *  Soroban contract events are emitted with a topic list of exactly two
 *  entries for the Round contract — topic[0] is the event name as a
 *  `symbol_short`, topic[1] the u64 round id — so the shape below mirrors the
 *  contract's `topicShape` from `@sub-rosa/round-bindings` event snapshot.
 *  The ordered `events` array on a receipt is what lets the offline verifier
 *  prove the round actually progressed through its on-chain lifecycle
 *  (created → commit → revealing → reveal → cleared → settled/voided) instead
 *  of trusting a hash-consistent but story-less export. */
export interface RoundReceiptEvent {
  /** Event name (Soroban `symbol_short!`), e.g. "commit", "settled".
   *  Must be one of the names in the round-bindings event snapshot. */
  name: RoundEventName;
  /** Ledger topics: ["symbol_short", "u64"]. topic[0] is the event name,
   *  topic[1] the round id the event belongs to. Kept as a tagged tuple so a
   *  receipt that scrambles topic order is detectable offline. */
  topics: readonly ["symbol_short", "u64"];
  /** The u64 round id carried by topic[1]. */
  roundId: string;
  /** Ledger sequence the event was included in. Ascending for a healthy
   *  round; a non-monotonic sequence betrays reordering or fabrication. */
  ledger: number;
  /** Lifecycle phase derived from the event name via
   *  `ROUND_EVENT_PHASE_BY_NAME` — recorded so receipts stay self-describing
   *  and so the verifier can cross-check the phase against the name. */
  phase: RoundEventPhase;
}

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
  /** The ordered on-chain event log for this round, in ledger order. The
   *  verifier rejects the receipt unless it lists the round's lifecycle events
   *  in order, with matching topics and round id (issue #379). */
  events: RoundReceiptEvent[];
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

/** Serialise a receipt to canonical JSON (deep-sorted keys, no whitespace).
 *  This is the format the CLI writes and the verifier reads. */
export function serializeReceipt(receipt: RoundReceipt): string {
  return JSON.stringify(receipt, sortKeys) + "\n";
}

/** Thrown when a receipt cannot be parsed or fails structural validation. */
export class ReceiptParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReceiptParseError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse a receipt from its canonical JSON form. */
export function parseReceipt(json: string): RoundReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ReceiptParseError("MALFORMED_JSON", "receipt is not valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new ReceiptParseError("MALFORMED_RECEIPT", "receipt must be a JSON object");
  }
  const version = parsed.version;
  if (typeof version !== "number" || !SUPPORTED_RECEIPT_VERSIONS.includes(version)) {
    throw new ReceiptParseError(
      "UNKNOWN_SCHEMA_VERSION",
      `unsupported receipt schema version: ${String(version)}`,
    );
  }
  return parsed as unknown as RoundReceipt;
}
