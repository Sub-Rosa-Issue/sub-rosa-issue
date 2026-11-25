// SPDX-License-Identifier: MIT
// Sealed-ciphertext wire format — the exact bytes `sealBid` emits and `openBid`
// consumes, inspected without decrypting and without touching the network.
//
// A tlock ciphertext is UTF-8 text: an ASCII-armored age file whose single
// recipient stanza is `-> tlock <round> <chainHash>`, followed by a `--- <mac>`
// line and the binary body. Reading that structure back is what lets a caller
// tell a real seal from a truncated, swapped, or foreign-round blob *before*
// spending gas on a commit that the contract would accept but could never open.
//
// Blob encoding and the commitment hash are separate concerns that must share
// one acceptance rule: the commitment is sha256(be16(value)‖nonce) from
// commitment.ts, and this module describes the ciphertext that commitment is
// supposed to be hiding inside. Neither package gets to redefine the other's
// format, so the shape lives here, next to the sealer, and the SDK's
// pre-commit gate reads it from this module.

import { PREIMAGE_BYTES } from "./commitment.js";

// ── Wire-format constants ────────────────────────────────────────────────

/** First line of the ASCII armor `tlock-js` writes around an age file. */
export const TLOCK_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";

/** Last line of that armor. */
export const TLOCK_ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";

/** The only age header version `tlock-js` reads or writes. */
export const AGE_VERSION = "age-encryption.org/v1";

/** Recipient stanza type tlock uses for a drand timelock recipient. */
export const TLOCK_STANZA_TYPE = "tlock";

/**
 * Base64 line width inside the armor. Both `tlock-js` and the Go age
 * implementation refuse to decode a payload whose lines are wider, so a blob
 * that does not respect it is not something the opener will ever read.
 */
export const ARMOR_LINE_WIDTH = 64;

/**
 * Padding-attack guard carried over from the Go age implementation: no more
 * than 1024 leading/trailing whitespace characters around the armor.
 */
const MAX_ARMOR_PADDING = 1024;

/**
 * Per-message overhead tlock-js adds to the age body: a 16-byte HKDF nonce
 * plus the 16-byte ChaCha20-Poly1305 tag STREAM appends to the single chunk.
 */
const BODY_OVERHEAD_BYTES = 32;

/** A drand chain hash is a 32-byte value in lowercase hex. */
const CHAIN_HASH_RE = /^[0-9a-f]{64}$/;

/** Standard (padded) base64 — the outer armor layer. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Unpadded base64 — the age stanza body inside the armor. */
const UNPADDED_BASE64_RE = /^[A-Za-z0-9+/]+$/;

// ── Parse result ──────────────────────────────────────────────────────────

/**
 * Machine-readable reason a sealed payload was rejected. Every value describes
 * a structural defect; none of them carry plaintext.
 */
export type SealedPayloadRejection =
  | "not_utf8"
  | "excessive_padding"
  | "missing_header"
  | "missing_footer"
  | "invalid_base64"
  | "line_too_long"
  | "missing_version"
  | "missing_recipient"
  | "not_tlock"
  | "malformed_recipient"
  | "missing_mac";

/** What a structurally valid sealed payload declares about itself. */
export interface SealedPayloadHeader {
  /** Drand round R the seal is locked to — the tlock stanza's first argument. */
  round: number;
  /** Drand chain hash the seal is bound to — the tlock stanza's second argument. */
  chainHash: string;
  /** Decoded bytes of the IBE ciphertext carried by the tlock stanza. */
  stanzaBodyBytes: number;
  /** Decoded bytes of the whole age payload (header + MAC + body). */
  payloadBytes: number;
  /**
   * Decoded bytes of the sealed plaintext, inferred from the body length.
   * A bid seal is exactly `PREIMAGE_BYTES` (48) — `be16(value)‖nonce`.
   */
  plaintextBytes: number;
}

export type SealedPayloadParse =
  | { ok: true; header: SealedPayloadHeader }
  | { ok: false; reason: SealedPayloadRejection };

const reject = (reason: SealedPayloadRejection): SealedPayloadParse => ({
  ok: false,
  reason,
});

// ── Parser ────────────────────────────────────────────────────────────────

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Inspect a tlock ciphertext's structure.
 *
 * Accepts the same input `openBid` accepts (raw bytes or the armored text) and
 * reports what the seal declares — the drand round it is locked to, the chain
 * hash it is bound to, and the plaintext length implied by the body. Nothing is
 * decrypted and no key material is needed, so this is safe to run on any blob
 * before it is committed, logged, or forwarded.
 *
 * A rejection means the blob is not a well-formed tlock payload: the armor is
 * missing or truncated, the age header is not the version the opener reads, the
 * recipient is not a tlock stanza, or the MAC line is absent.
 */
export function parseSealedPayload(
  ciphertext: Uint8Array | string,
): SealedPayloadParse {
  const text = typeof ciphertext === "string" ? ciphertext : decodeUtf8(ciphertext);
  if (text === null) return reject("not_utf8");

  // The opener trims the armor before decoding, so trimming here keeps this
  // check aligned with what would actually be read back.
  const trimmed = text.trim();
  if (text.length - trimmed.length > MAX_ARMOR_PADDING) {
    return reject("excessive_padding");
  }
  if (!trimmed.startsWith(TLOCK_ARMOR_HEADER)) return reject("missing_header");
  if (!trimmed.endsWith(TLOCK_ARMOR_FOOTER)) return reject("missing_footer");

  const armored = trimmed.slice(
    TLOCK_ARMOR_HEADER.length,
    trimmed.length - TLOCK_ARMOR_FOOTER.length,
  );
  const armoredLines = armored.split("\n");
  // A line wider than the armor width, or a final line exactly as wide, is the
  // padding-attack shape both age implementations refuse to decode.
  if (armoredLines.some((line) => line.length > ARMOR_LINE_WIDTH)) {
    return reject("line_too_long");
  }
  if (armoredLines[armoredLines.length - 1].length >= ARMOR_LINE_WIDTH) {
    return reject("line_too_long");
  }

  // `encodeArmor` emits a blank line before the footer when the last base64
  // line lands exactly on the armor width, so blank lines carry no payload.
  const base64 = armoredLines.filter((line) => line.length > 0).join("");
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
    return reject("invalid_base64");
  }
  const payload = Buffer.from(base64, "base64");

  return parseAgePayload(payload);
}

/** Decode UTF-8 bytes, or `null` when they are not valid UTF-8 text. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Walk the age header: version line, the single tlock stanza, the MAC line.
 * Everything after the MAC line's newline is the binary body, whose length
 * pins down how many plaintext bytes the seal holds.
 */
function parseAgePayload(payload: Buffer): SealedPayloadParse {
  // The header is pure ASCII, so latin1 keeps one byte per character and the
  // offsets below stay byte-exact even though the body is arbitrary binary.
  const lines = payload.toString("latin1").split("\n");
  let consumed = 0;
  const take = (): string => {
    const line = lines.shift() ?? "";
    consumed += line.length + 1; // +1 for the newline that joined it
    return line;
  };

  if (take() !== AGE_VERSION) return reject("missing_version");

  const stanza = take();
  if (!stanza.startsWith("-> ")) return reject("missing_recipient");
  const [type, ...args] = stanza.slice(3).split(" ");
  if (type !== TLOCK_STANZA_TYPE) return reject("not_tlock");
  if (args.length !== 2) return reject("malformed_recipient");
  const [rawRound, chainHash] = args;
  if (!/^[0-9]+$/.test(rawRound)) return reject("malformed_recipient");
  if (!CHAIN_HASH_RE.test(chainHash)) return reject("malformed_recipient");
  const round = Number(rawRound);
  if (!Number.isSafeInteger(round) || round < 1) return reject("malformed_recipient");

  // Read the stanza body up to the MAC line. The stanza may wrap over several
  // 64-column lines; a line starting with `--- ` always ends it.
  const stanzaLines: string[] = [];
  for (;;) {
    if (lines.length === 0) return reject("missing_mac");
    const line = lines[0];
    if (line.startsWith("--- ")) break;
    stanzaLines.push(take());
  }
  if (lines.length === 0) return reject("missing_mac");
  if (stanzaLines.length === 0) return reject("malformed_recipient");
  const stanzaBody = stanzaLines.join("");
  if (stanzaBody.length % 4 === 1 || !UNPADDED_BASE64_RE.test(stanzaBody)) {
    return reject("malformed_recipient");
  }

  const macLine = take();
  if (!macLine.startsWith("--- ")) return reject("missing_mac");
  const mac = macLine.slice(4);
  if (mac.length === 0 || !UNPADDED_BASE64_RE.test(mac)) return reject("missing_mac");

  // The body starts after the newline that terminates the MAC line. When the
  // payload ends on that line there is no body, and `lines` is already empty.
  const bodyBytes = payload.length - (consumed - 1) - (lines.length > 0 ? 1 : 0);
  const plaintextBytes = bodyBytes - BODY_OVERHEAD_BYTES;

  return {
    ok: true,
    header: {
      round,
      chainHash,
      stanzaBodyBytes: Math.floor((stanzaBody.length / 4) * 3),
      payloadBytes: payload.length,
      plaintextBytes,
    },
  };
}

/**
 * The plaintext length a `sealBid` payload always has: the 48-byte commitment
 * preimage `be16(value)‖nonce`, and nothing else. A sealed payload of any other
 * implied length is not a bid seal — it is some other age payload wearing the
 * same armor, and its commitment says nothing about it.
 */
export const SEALED_BID_PLAINTEXT_BYTES = PREIMAGE_BYTES;

/** True when the payload's implied plaintext length is a bid preimage. */
export function isSealedBidPayload(header: SealedPayloadHeader): boolean {
  return header.plaintextBytes === SEALED_BID_PLAINTEXT_BYTES;
}
