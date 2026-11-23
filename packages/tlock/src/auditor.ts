// Copyright (c) 2026 Sub Rosa contributors
// Auditor identity blob — selective disclosure.
//
// Bid values unseal publicly after round R (the auditability guarantee), but
// bidder identities are encrypted to a designated auditor's key and readable
// only by the auditor. This is an ECIES-style sealed box: an ephemeral X25519
// key agreement with the auditor's public key, HKDF-SHA256 to a symmetric key,
// and XChaCha20-Poly1305 AEAD.
//
// Blob layout: ephPub(32) ‖ nonce(24) ‖ ciphertext(+16 tag).
//
// Identity binding (issue #382): the AEAD alone only proves the blob was sealed
// to *some* bidder. Because the ciphertext is not bound to who it belongs to,
// an auditor blob is swappable — placing one bidder's blob in another's slot
// decrypts cleanly and discloses the wrong identity, which is a disclosure bug
// rather than a decode error.
//
// The bound payload therefore carries the bidder context:
//
//   plain = magic(4) ‖ version(1) ‖ round(8) ‖ identityLen(4) ‖
//           commitment(32) ‖ identity(N)
//
// and `openIdentityForBidder` re-derives that context from the caller and
// refuses to return an identity unless it matches exactly. Swapped,
// cross-round and wrong-commitment blobs therefore fail with a stable error
// and yield no identity.

import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";

const EPH_PUB_BYTES = 32;
const NONCE_BYTES = 24;
const HKDF_INFO = new TextEncoder().encode("sub-rosa/auditor-blob/v1");

/// Bumped when the bound payload layout changes. Version 0 is the unbound
/// legacy format produced by `sealIdentity`; version 1 is identity-bound.
export const IDENTITY_BLOB_VERSION = 1;

const PAYLOAD_MAGIC = new Uint8Array([0x53, 0x52, 0x41, 0x49]); // "SRAI"
const PAYLOAD_VERSION_OFFSET = 4;
const PAYLOAD_ROUND_OFFSET = 5;
const PAYLOAD_ROUND_BYTES = 8;
const PAYLOAD_LENGTH_OFFSET = PAYLOAD_ROUND_OFFSET + PAYLOAD_ROUND_BYTES;
const PAYLOAD_COMMITMENT_OFFSET = PAYLOAD_LENGTH_OFFSET + 4;
const COMMITMENT_BYTES = 32;
const PAYLOAD_IDENTITY_OFFSET = PAYLOAD_COMMITMENT_OFFSET + COMMITMENT_BYTES;
const PAYLOAD_HEADER_BYTES = PAYLOAD_IDENTITY_OFFSET;
/// Upper bound on an identity so a hostile length prefix cannot make the
/// decoder allocate unbounded memory.
const MAX_IDENTITY_BYTES = 4096;

export interface AuditorKeypair {
  secretKey: Uint8Array; // 32-byte X25519 scalar
  publicKey: Uint8Array; // 32-byte X25519 public key
}

export interface SealIdentityForBidderParams {
  /// The bidder identity bytes to protect.
  identity: Uint8Array;
  /// Drand round this bid was sealed in.
  round: number;
  /// The bid's 32-byte commitment H, binding the blob to a specific bid.
  commitment: Uint8Array;
  /// Auditor public key the blob is sealed to.
  auditorPublicKey: Uint8Array;
}

export interface OpenIdentityForBidderParams {
  /// The auditor's X25519 secret key.
  auditorSecretKey: Uint8Array;
  /// The Drand round the caller expects.
  round: number;
  /// The bid commitment the caller expects.
  commitment: Uint8Array;
}

export interface OpenedIdentity {
  /// The recovered identity, only ever returned after binding verification.
  identity: Uint8Array;
  /// Round and commitment recovered from the blob (equal to those supplied).
  round: number;
  commitment: Uint8Array;
}

/// Raised when a blob's embedded identity context does not match the caller's.
export class IdentityBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityBindingError";
  }
}

export function generateAuditorKeypair(): AuditorKeypair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function auditorPublicKey(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

function deriveKey(shared: Uint8Array, ephPub: Uint8Array, auditorPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(EPH_PUB_BYTES * 2);
  salt.set(ephPub, 0);
  salt.set(auditorPub, EPH_PUB_BYTES);
  return hkdf(sha256, shared, salt, HKDF_INFO, 32);
}

/// Encrypt a bidder identity so that only the holder of `auditorPublicKey` can
/// read it. `identity` is arbitrary bytes (e.g. a UTF-8 name or address).
export function sealIdentity(identity: Uint8Array, auditorPublicKey: Uint8Array): Uint8Array {
  const ephSecret = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSecret);
  const shared = x25519.getSharedSecret(ephSecret, auditorPublicKey);
  const key = deriveKey(shared, ephPub, auditorPublicKey);
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce).encrypt(identity);

  const blob = new Uint8Array(EPH_PUB_BYTES + NONCE_BYTES + ct.length);
  blob.set(ephPub, 0);
  blob.set(nonce, EPH_PUB_BYTES);
  blob.set(ct, EPH_PUB_BYTES + NONCE_BYTES);
  return blob;
}

/// Decrypt an auditor blob with the auditor's secret key. Throws if the blob is
/// malformed or was sealed to a different auditor key.
export function openIdentity(blob: Uint8Array, auditorSecretKey: Uint8Array): Uint8Array {
  if (blob.length < EPH_PUB_BYTES + NONCE_BYTES) {
    throw new Error("auditor blob too short");
  }
  const ephPub = blob.slice(0, EPH_PUB_BYTES);
  const nonce = blob.slice(EPH_PUB_BYTES, EPH_PUB_BYTES + NONCE_BYTES);
  const ct = blob.slice(EPH_PUB_BYTES + NONCE_BYTES);
  const auditorPub = x25519.getPublicKey(auditorSecretKey);
  const shared = x25519.getSharedSecret(auditorSecretKey, ephPub);
  const key = deriveKey(shared, ephPub, auditorPub);
  return xchacha20poly1305(key, nonce).decrypt(ct);
}

// ── Identity-bound blob payload (issue #382) ─────────────────────────────────

function assertRound(round: number): void {
  if (!Number.isInteger(round) || round < 0 || round >= 2 ** 32) {
    throw new RangeError(`round must be a 32-bit unsigned integer, got ${round}`);
  }
}

function assertCommitment(commitment: Uint8Array): void {
  if (commitment.length !== COMMITMENT_BYTES) {
    throw new Error(`commitment must be ${COMMITMENT_BYTES} bytes, got ${commitment.length}`);
  }
}

/// Encode the identity-bound plaintext that goes inside the sealed box.
function encodeBoundPayload(
  identity: Uint8Array,
  round: number,
  commitment: Uint8Array,
): Uint8Array {
  assertRound(round);
  assertCommitment(commitment);
  if (identity.length === 0) {
    throw new Error("identity must not be empty");
  }
  if (identity.length > MAX_IDENTITY_BYTES) {
    throw new RangeError(
      `identity must be at most ${MAX_IDENTITY_BYTES} bytes, got ${identity.length}`,
    );
  }

  const out = new Uint8Array(PAYLOAD_HEADER_BYTES + identity.length);
  out.set(PAYLOAD_MAGIC, 0);
  out[PAYLOAD_VERSION_OFFSET] = IDENTITY_BLOB_VERSION;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(PAYLOAD_ROUND_OFFSET, BigInt(round), false);
  view.setUint32(PAYLOAD_LENGTH_OFFSET, identity.length, false);
  out.set(commitment, PAYLOAD_COMMITMENT_OFFSET);
  out.set(identity, PAYLOAD_IDENTITY_OFFSET);
  return out;
}

/**
 * Strictly decode a bound payload. Every length is validated before it is used,
 * so a truncated or hostile payload is rejected instead of read out of bounds.
 */
function decodeBoundPayload(plain: Uint8Array): OpenedIdentity {
  if (plain.length < PAYLOAD_HEADER_BYTES) {
    throw new Error("auditor payload too short");
  }
  if (!PAYLOAD_MAGIC.every((byte, index) => plain[index] === byte)) {
    throw new Error("invalid auditor payload magic");
  }
  const version = plain[PAYLOAD_VERSION_OFFSET];
  if (version !== IDENTITY_BLOB_VERSION) {
    throw new Error(`unsupported auditor payload version ${version}`);
  }

  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const roundBig = view.getBigUint64(PAYLOAD_ROUND_OFFSET, false);
  if (roundBig > 0xffffffffn) {
    throw new Error("auditor payload round exceeds 32 bits");
  }
  const round = Number(roundBig);

  const identityLength = view.getUint32(PAYLOAD_LENGTH_OFFSET, false);
  if (identityLength === 0) {
    throw new Error("auditor payload identity must not be empty");
  }
  if (identityLength > MAX_IDENTITY_BYTES) {
    throw new RangeError(
      `auditor payload identity must be at most ${MAX_IDENTITY_BYTES} bytes, got ${identityLength}`,
    );
  }
  // Exact-length check: rejects truncation and trailing garbage alike.
  if (plain.length !== PAYLOAD_HEADER_BYTES + identityLength) {
    throw new Error(
      `auditor payload length mismatch: header declares ${identityLength}, got ${plain.length - PAYLOAD_HEADER_BYTES}`,
    );
  }

  return {
    identity: plain.slice(PAYLOAD_IDENTITY_OFFSET),
    round,
    commitment: plain.slice(PAYLOAD_COMMITMENT_OFFSET, PAYLOAD_IDENTITY_OFFSET),
  };
}

/**
 * Validate the outer blob framing and return the encrypted envelope. Split out
 * so the recovery CLI can reject a malformed blob before any decryption is
 * attempted.
 */
export function decodeIdentityBlob(blob: Uint8Array): {
  ephPub: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
} {
  if (!blob || blob.length < EPH_PUB_BYTES + NONCE_BYTES) {
    throw new Error("auditor blob too short");
  }
  // The minimum bound blob also carries an AEAD tag, so anything shorter cannot
  // be a valid sealed box.
  const minimum = EPH_PUB_BYTES + NONCE_BYTES + 16;
  if (blob.length < minimum) {
    throw new Error(
      `auditor blob too short: expected at least ${minimum} bytes, got ${blob.length}`,
    );
  }
  return {
    ephPub: blob.slice(0, EPH_PUB_BYTES),
    nonce: blob.slice(EPH_PUB_BYTES, EPH_PUB_BYTES + NONCE_BYTES),
    ciphertext: blob.slice(EPH_PUB_BYTES + NONCE_BYTES),
  };
}

/**
 * Seal a bidder identity bound to the bid's round and commitment.
 *
 * The binding lives inside the encrypted payload rather than in the AEAD
 * associated data, so a blob cannot be replayed against a different bidder
 * even by someone who holds the auditor key.
 */
export function sealIdentityForBidder(params: SealIdentityForBidderParams): Uint8Array {
  const { identity, round, commitment, auditorPublicKey } = params;
  const plain = encodeBoundPayload(identity, round, commitment);
  return sealIdentity(plain, auditorPublicKey);
}

/**
 * Decrypt an auditor blob and return its identity only if the blob's round and
 * commitment match the ones the caller expects.
 *
 * Throws `IdentityBindingError` on a mismatch; the identity is never returned
 * in that case, so a swapped or cross-round blob discloses nothing.
 */
export function openIdentityForBidder(
  blob: Uint8Array,
  params: OpenIdentityForBidderParams,
): OpenedIdentity {
  assertRound(params.round);
  assertCommitment(params.commitment);

  // Validate the outer framing before touching the cipher, so a truncated or
  // malformed blob is rejected rather than handed to the AEAD.
  decodeIdentityBlob(blob);
  const plain = openIdentity(blob, params.auditorSecretKey);
  const opened = decodeBoundPayload(plain);

  // Order matters: report the round mismatch first, then the bidder binding, so
  // a cross-round blob does not look like a same-round swap.
  if (opened.round !== params.round) {
    throw new IdentityBindingError(
      `auditor blob round mismatch: blob is for round ${opened.round}, expected ${params.round}`,
    );
  }
  if (!equalBytes(opened.commitment, params.commitment)) {
    throw new IdentityBindingError(
      "auditor blob identity commitment mismatch: blob was sealed for a different bidder",
    );
  }
  return opened;
}

/**
 * Report whether a decrypted blob carries the identity-bound format.
 *
 * The recovery CLI uses this so an unbound recovery never prints a bound
 * blob's raw wrapper — which would still contain the bidder identity and so
 * would leak it without proving which bidder it belongs to.
 */
export function isIdentityBound(blob: Uint8Array, auditorSecretKey: Uint8Array): boolean {
  try {
    decodeBoundPayload(openIdentity(blob, auditorSecretKey));
    return true;
  } catch {
    return false;
  }
}

/// Length-independent, constant-time-ish comparison of two 32-byte commitments.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
