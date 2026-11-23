// SPDX-License-Identifier: MIT
// Encrypted blob validation — size, content-type, encoding, and seal binding.
//
// The contract enforces a 4096-byte maximum for ciphertext (Soroban Temporary
// storage limit). Auditor blobs have no on-chain limit beyond the general
// contract payload limit, but realistically a sealed identity (ECIES X25519 +
// XChaCha20-Poly1305) is ~56–200 bytes. Both limits are conservative and keep
// the per-bid storage well under the per-entry cost.
//
// These validation functions give callers early, clear feedback before paying
// gas for a contract call that would revert with PayloadTooLarge (error 33).
//
// `validateSealedBid` goes further and is the gate a bid should pass *before*
// commit. Size and encoding live in one package, the tlock commitment in
// another, and a blob can satisfy the first while failing the second — which is
// the dangerous case, because the contract happily stores a commitment it will
// never be able to open. One acceptance rule, shared with the sealer, avoids
// committing a seal that is dead on arrival.

import {
  QUICKNET_HASH,
  COMMITMENT_BYTES,
  NONCE_BYTES,
  ARMOR_LINE_WIDTH,
  TLOCK_ARMOR_HEADER,
  TLOCK_ARMOR_FOOTER,
  AGE_VERSION,
  TLOCK_STANZA_TYPE,
  SEALED_BID_PLAINTEXT_BYTES,
  commitmentMatches,
  isSealedBidPayload,
  parseSealedPayload,
} from "@sub-rosa/tlock";
import type { SealedBid, SealedPayloadHeader } from "@sub-rosa/tlock";
import { SubRosaClientConfigError } from "./errors.js";

// ── Blob size limits (bytes) ─────────────────────────────────────────────

/**
 * Maximum allowed size for a tlock ciphertext blob.
 *
 * The Soroban contract enforces this limit on-chain (PayloadTooLarge, error 33).
 * 4096 bytes matches the maximum Temporary storage entry size for a single
 * bid's ciphertext in the Round contract.
 *
 * @default 4096
 */
export const MAX_CIPHERTEXT_BYTES = 4096;

/**
 * Maximum allowed size for an encrypted auditor identity blob.
 *
 * An auditor blob is an ECIES sealed box: 32-byte ephemeral public key +
 * 24-byte nonce + ciphertext (+16 AEAD tag). Typical identity strings are
 * 20–100 bytes, producing blobs of 92–172 bytes. The 1024 limit leaves
 * generous room for longer identities well below the Temporary storage cap.
 *
 * @default 1024
 */
export const MAX_AUDITOR_BLOB_BYTES = 1024;

// ── Content types ────────────────────────────────────────────────────────

/**
 * Discriminated union for the kind of encrypted blob being validated.
 *
 * - `ciphertext`: tlock-encrypted bid payload (raw Uint8Array / Buffer).
 * - `auditor_blob`: ECIES-encrypted bidder identity (raw Uint8Array / Buffer).
 * - `evidence_ciphertext`: hex-encoded ciphertext from a receipt evidence block.
 * - `evidence_auditor_blob`: hex-encoded auditor blob from a receipt evidence block.
 */
export type BlobContentType =
  | "ciphertext"
  | "auditor_blob"
  | "evidence_ciphertext"
  | "evidence_auditor_blob";

const CONTENT_TYPE_SET: ReadonlySet<string> = new Set([
  "ciphertext",
  "auditor_blob",
  "evidence_ciphertext",
  "evidence_auditor_blob",
]);

const HUMAN_LABELS: Record<BlobContentType, string> = {
  ciphertext: "ciphertext",
  auditor_blob: "auditor blob",
  evidence_ciphertext: "evidence ciphertext",
  evidence_auditor_blob: "evidence auditor blob",
};

// ── Validation result ────────────────────────────────────────────────────

export interface BlobValidationIssue {
  /** Machine-readable code. */
  code: string;
  /** Human-readable explanation. */
  message: string;
}

export interface BlobValidationResult {
  /** `true` when all checks pass. */
  valid: boolean;
  /** Ordered list of issues found. */
  issues: BlobValidationIssue[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

const HEX_RE = /^[0-9a-f]+$/i;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isHex(s: string): boolean {
  return HEX_RE.test(s);
}

function isBase64(s: string): boolean {
  return BASE64_RE.test(s) && s.length % 4 === 0;
}

/**
 * Return the maximum allowed bytes for a given content type.
 * `evidence_*` types are hex-encoded strings, so their byte limit refers to
 * the *decoded* payload size (i.e. the underlying raw blob).
 */
function maxBytesForType(contentType: BlobContentType): number {
  switch (contentType) {
    case "ciphertext":
    case "evidence_ciphertext":
      return MAX_CIPHERTEXT_BYTES;
    case "auditor_blob":
    case "evidence_auditor_blob":
      return MAX_AUDITOR_BLOB_BYTES;
  }
}

/**
 * Parse the hex-encoded string representation of a blob into raw bytes.
 * Returns `null` if the string is not valid hex.
 */
export function tryDecodeHex(s: string): { bytes: Uint8Array; length: number } | null {
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  if (!isHex(hex)) return null;
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return { bytes, length: bytes.length };
}

/**
 * Decode the base64-encoded string representation of a blob into raw bytes.
 * Returns `null` if the string is not valid base64.
 */
export function tryDecodeBase64(s: string): { bytes: Uint8Array; length: number } | null {
  if (!isBase64(s)) return null;
  // Buffer.from with base64 never throws — invalid chars are silently skipped.
  // The isBase64 regex above already guarantees the string is well-formed.
  const bytes = new Uint8Array(Buffer.from(s, "base64"));
  return { bytes, length: bytes.length };
}

// ── Validator ────────────────────────────────────────────────────────────

/**
 * Validate an encrypted blob for size, content-type, and encoding.
 *
 * Supports two calling modes:
 *
 * **Raw bytes** — pass a `Uint8Array` or `Buffer` (the typical SDK path):
 * ```ts
 * validateEncryptedBlob(ciphertext, "ciphertext");
 * ```
 *
 * **Hex/base64 string** — pass a string encoding (e.g. from a receipt):
 * ```ts
 * validateEncryptedBlob("abcd1234...", "evidence_ciphertext");
 * ```
 *
 * @param blob — The encrypted blob as raw bytes or a hex/base64 string.
 * @param contentType — Discriminates which kind of blob (determines the
 *   size limit applied).
 * @param options — Optional overrides.
 */
export function validateEncryptedBlob(
  blob: Uint8Array | string,
  contentType: string,
  options?: {
    /** Override the max size for this call (bytes). */
    maxBytes?: number;
    /** Expected encoding for string blobs. Default: auto-detect hex then base64. */
    encoding?: "hex" | "base64";
  },
): BlobValidationResult {
  const issues: BlobValidationIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({ code, message });

  // ── Content type ────────────────────────────────────────────────────
  if (!contentType) {
    add("missing_content_type", "content type must be provided");
    return { valid: false, issues };
  }
  if (!CONTENT_TYPE_SET.has(contentType)) {
    add(
      "unsupported_content_type",
      `unsupported content type "${contentType}"; expected one of: ${[...CONTENT_TYPE_SET].join(", ")}`,
    );
    // Can't proceed — we don't know what limits to apply.
    return { valid: false, issues };
  }
  const ct = contentType as BlobContentType;

  // ── Determine raw size and encoding validity ────────────────────────
  let rawBytes: Uint8Array;
  let byteLength: number;

  if (typeof blob === "string") {
    const encoding = options?.encoding;
    let hexDecoded: ReturnType<typeof tryDecodeHex> = null;
    let b64Decoded: ReturnType<typeof tryDecodeBase64> = null;

    if (encoding === "hex") {
      hexDecoded = tryDecodeHex(blob);
    } else if (encoding === "base64") {
      b64Decoded = tryDecodeBase64(blob);
    } else {
      hexDecoded = tryDecodeHex(blob);
      b64Decoded = hexDecoded ? null : tryDecodeBase64(blob);
    }

    const decoded = hexDecoded ?? b64Decoded;
    if (decoded) {
      rawBytes = decoded.bytes;
      byteLength = decoded.length;
    } else {
      // Not valid hex or base64.
      add(
        "invalid_encoding",
        `${HUMAN_LABELS[ct]} is not valid ${encoding ?? "hex or base64"} encoding (length=${blob.length})`,
      );
      return { valid: false, issues };
    }
  } else if (blob instanceof Uint8Array) {
    rawBytes = blob;
    byteLength = blob.length;
  } else {
    add("invalid_type", "blob must be a Uint8Array, Buffer, or hex/base64 string");
    return { valid: false, issues };
  }

  // ── Empty check ─────────────────────────────────────────────────────
  if (byteLength === 0) {
    add("empty_blob", `${HUMAN_LABELS[ct]} must not be empty`);
    // Empty blob fails size checks too, but report empty as the primary issue.
    return { valid: false, issues };
  }

  // ── Size check ──────────────────────────────────────────────────────
  const max = options?.maxBytes ?? maxBytesForType(ct);
  if (byteLength > max) {
    add(
      "blob_too_large",
      `${HUMAN_LABELS[ct]} is ${byteLength} bytes, exceeding the maximum of ${max} bytes`,
    );
  }

  return { valid: issues.length === 0, issues };
}

// ── Sealed-bid acceptance gate ────────────────────────────────────────────

/**
 * The plaintext a sealed bid was produced from.
 *
 * Supplying this is what upgrades `validateSealedBid` from a structural check
 * to a full binding check: the commitment is re-derived with tlock's own
 * helper and compared against the H that is about to be committed.
 */
export interface SealedBidBinding {
  /** The value inside the seal. Never echoed in an error message. */
  value: bigint;
  /** The 32-byte nonce inside the seal. */
  nonce: Uint8Array;
  /** The Drand round R the seal is expected to be locked to. */
  round: number;
  /**
   * The Drand chain hash the seal is expected to be bound to. The contract
   * verifies quicknet, so that is the default.
   */
  chainHash?: string;
}

/** Human-readable explanation for each sealed-payload rejection reason. */
const PAYLOAD_REJECTIONS: Record<string, string> = {
  not_utf8: "ciphertext is not valid UTF-8 text",
  excessive_padding: "ciphertext has more than 1024 bytes of padding around the armor",
  missing_header: `ciphertext is missing the "${TLOCK_ARMOR_HEADER}" armor header`,
  missing_footer: `ciphertext is missing the "${TLOCK_ARMOR_FOOTER}" armor footer`,
  invalid_base64: "armored ciphertext is not valid base64",
  line_too_long: `armored ciphertext has a base64 line wider than ${ARMOR_LINE_WIDTH} columns`,
  missing_version: `ciphertext is not an ${AGE_VERSION} payload`,
  missing_recipient: "ciphertext has no age recipient stanza",
  not_tlock: `ciphertext recipient is not a "${TLOCK_STANZA_TYPE}" stanza`,
  malformed_recipient: "ciphertext tlock stanza is malformed",
  missing_mac: "ciphertext is missing its age MAC line",
};

/**
 * Validate a `SealedBid` from `@sub-rosa/tlock` against the rules the sealer
 * and the contract both work to, before it is committed on-chain.
 *
 * Three layers, in the order a blob can fail them:
 *
 * 1. **Encoding** — the ciphertext is a well-formed tlock payload: age armor
 *    intact, `age-encryption.org/v1` header, a `-> tlock <round> <hash>`
 *    recipient, and a MAC line. Truncation, a hex/base64 string where a raw
 *    blob belongs, and a blob that is some other age file all fail here.
 * 2. **Length** — the ciphertext fits the contract's storage limit, the
 *    commitment is exactly 32 bytes, and the payload's implied plaintext length
 *    is the 48-byte `be16(value)‖nonce` preimage a bid always carries.
 * 3. **Binding** (when `binding` is given) — the round and chain hash the seal
 *    declares are the ones it was sealed for, and the commitment equals
 *    `sha256(be16(value)‖nonce)` recomputed by tlock's own `commitmentMatches`.
 *
 * A blob that passes all three is one the contract can check at reveal. Error
 * messages describe the defect and never carry the bid value or the plaintext.
 */
export function validateSealedBid(
  sealed: SealedBid,
  binding?: SealedBidBinding,
): BlobValidationResult {
  const issues: BlobValidationIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });

  // ── 1. Encoding and size ────────────────────────────────────────────
  const ciphertext = validateEncryptedBlob(sealed?.ciphertext, "ciphertext");
  for (const issue of ciphertext.issues) {
    add(issue.code, issue.message);
  }

  // The contract takes `auditor_blob` as optional Bytes; `sealBid` emits an
  // empty blob when the bidder discloses no identity. Validate the size when
  // there is one, and stay quiet when there is not.
  if (sealed?.auditorBlob && sealed.auditorBlob.length > 0) {
    const auditorBlob = validateEncryptedBlob(sealed.auditorBlob, "auditor_blob");
    for (const issue of auditorBlob.issues) {
      add(issue.code, issue.message);
    }
  }

  // ── 2. Length ───────────────────────────────────────────────────────
  let commitmentWidthOk = false;
  if (!(sealed?.commitment instanceof Uint8Array)) {
    add("invalid_commitment", "commitment must be a Uint8Array");
  } else if (sealed.commitment.length !== COMMITMENT_BYTES) {
    add(
      "invalid_commitment_length",
      `commitment is ${sealed.commitment.length} bytes, expected ${COMMITMENT_BYTES}`,
    );
  } else {
    commitmentWidthOk = true;
  }

  let header: SealedPayloadHeader | null = null;
  if (sealed?.ciphertext instanceof Uint8Array && sealed.ciphertext.length > 0) {
    const parsed = parseSealedPayload(sealed.ciphertext);
    if (!parsed.ok) {
      add(
        "invalid_sealed_payload",
        PAYLOAD_REJECTIONS[parsed.reason] ?? `ciphertext is not a tlock payload (${parsed.reason})`,
      );
    } else {
      header = parsed.header;
      if (!isSealedBidPayload(parsed.header)) {
        add(
          "unexpected_plaintext_length",
          `sealed payload holds ${parsed.header.plaintextBytes} plaintext bytes, expected ${SEALED_BID_PLAINTEXT_BYTES} (a 16-byte value plus a 32-byte nonce)`,
        );
      }
    }
  }

  // ── 3. Binding to the value, nonce, and round ───────────────────────
  if (binding) {
    const expectedChainHash = binding.chainHash ?? QUICKNET_HASH;
    if (header) {
      if (header.round !== binding.round) {
        add(
          "round_mismatch",
          `sealed bid is locked to drand round ${header.round}, not round ${binding.round}`,
        );
      }
      if (header.chainHash !== expectedChainHash) {
        add(
          "chain_mismatch",
          `sealed bid is bound to drand chain ${header.chainHash}, not the contract's chain`,
        );
      }
    }

    if (!(binding.nonce instanceof Uint8Array) || binding.nonce.length !== NONCE_BYTES) {
      add(
        "invalid_nonce_length",
        `nonce is ${binding.nonce?.length ?? 0} bytes, expected ${NONCE_BYTES}`,
      );
    } else if (commitmentWidthOk) {
      // The shared rule: the same helper the sealer used to derive H. A
      // wrong-width commitment already failed the length check, so it is not
      // also reported as a mismatch.
      if (!commitmentMatches(binding.value, binding.nonce, sealed.commitment as Uint8Array)) {
        // The value stays out of the message on purpose — errors get logged.
        add(
          "commitment_mismatch",
          "sealed bid commitment does not match sha256(be16(value) || nonce) of the supplied value and nonce; the contract would never open this seal",
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * `validateSealedBid` as a throw, for call sites that gate a commit.
 * Rejects with `SubRosaClientConfigError` listing every defect found, so a
 * caller sees all of them at once rather than one per attempt.
 */
export function assertSealedBid(
  sealed: SealedBid,
  binding?: SealedBidBinding,
): void {
  const result = validateSealedBid(sealed, binding);
  if (!result.valid) {
    throw new SubRosaClientConfigError(
      result.issues.map((issue) => issue.message).join("; "),
    );
  }
}

