// Copyright (c) 2026 Sub Rosa contributors
// Encrypted blob validation tests.
//
// These tests validate the helper/schema that accepts encrypted blob payloads
// (ciphertext, auditor_blob, evidence). Guardrails:
//   - Do not decrypt blobs in tests.
//   - Do not log raw blob contents.
//   - Keep limits conservative and configurable only if the codebase already
//     has config patterns.
//
// The `validateSealedBid` section is the bid acceptance rule. Its fixtures are
// real `sealBid` output — produced offline against a stub Drand client that
// serves quicknet's static public key — so the gate is checked against the
// sealer it has to agree with rather than against a hand-written stand-in.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QUICKNET_HASH, commitment, generateAuditorKeypair, type SealedBid } from "@sub-rosa/tlock";
import { SubRosaClientConfigError } from "./errors.js";
import {
  validateEncryptedBlob,
  validateSealedBid,
  assertSealedBid,
  MAX_CIPHERTEXT_BYTES,
  MAX_AUDITOR_BLOB_BYTES,
  tryDecodeHex,
  tryDecodeBase64,
  type SealedBidBinding,
} from "./encrypted-blob.js";
import {
  BID_NONCE,
  BID_ROUND,
  BID_VALUE,
  sealFixture,
  fixtureBinding,
} from "./testing/seal-fixture.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a Uint8Array of the given length filled with a repeating byte. */
const u8 = (len: number, fill = 0x42): Uint8Array =>
  new Uint8Array(len).fill(fill);

/** Encode raw bytes as a lowercase hex string. */
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Encode raw bytes as base64. Uses Buffer for consistency with the
 * rest of the codebase (lifecycle-e2e.ts, mandate.ts, etc.).
 */
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ── Content-type validation ──────────────────────────────────────────────

test("rejects missing content type", () => {
  const result = validateEncryptedBlob(u8(10), "");
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "missing_content_type");
  assert.match(result.issues[0].message, /content type must be provided/);
});

test("rejects unsupported content type", () => {
  const result = validateEncryptedBlob(u8(10), "unsupported_blob_type");
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "unsupported_content_type");
  assert.match(result.issues[0].message, /unsupported content type/);
  assert.match(result.issues[0].message, /evidence_auditor_blob/);
});

// ── Empty blob validation ────────────────────────────────────────────────

test("rejects empty ciphertext (raw bytes)", () => {
  const result = validateEncryptedBlob(new Uint8Array(0), "ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
  assert.match(result.issues[0].message, /ciphertext must not be empty/);
});

test("rejects empty auditor blob (raw bytes)", () => {
  const result = validateEncryptedBlob(new Uint8Array(0), "auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
  assert.match(result.issues[0].message, /auditor blob must not be empty/);
});

test("rejects empty hex-encoded evidence ciphertext", () => {
  const result = validateEncryptedBlob("", "evidence_ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
});

test("rejects empty base64-encoded evidence auditor blob", () => {
  const result = validateEncryptedBlob("", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
});

// ── Valid blobs ──────────────────────────────────────────────────────────

test("accepts a valid ciphertext at the maximum boundary", () => {
  const result = validateEncryptedBlob(u8(MAX_CIPHERTEXT_BYTES), "ciphertext");
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test("accepts a valid auditor blob at the maximum boundary", () => {
  const result = validateEncryptedBlob(u8(MAX_AUDITOR_BLOB_BYTES), "auditor_blob");
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test("accepts a realistic ciphertext (age-armored tlock output)", () => {
  // Realistic tlock output is ~800-1500 bytes of age-armored ciphertext.
  const realistic = u8(1024, 0x61); // 'a' filler
  const result = validateEncryptedBlob(realistic, "ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a realistic auditor blob (~72-200 bytes)", () => {
  // Typical auditor blob: 32-byte eph pub + 24-byte nonce + ~20 byte id + 16 AEAD tag = 92 bytes
  const realistic = u8(92);
  const result = validateEncryptedBlob(realistic, "auditor_blob");
  assert.equal(result.valid, true);
});

test("accepts a valid hex-encoded evidence ciphertext", () => {
  const raw = u8(512);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a valid hex-encoded evidence auditor blob", () => {
  const raw = u8(92);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_auditor_blob");
  assert.equal(result.valid, true);
});

test("accepts a valid base64-encoded evidence ciphertext", () => {
  const raw = u8(512);
  const b64Str = b64(raw);
  const result = validateEncryptedBlob(b64Str, "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a valid base64-encoded evidence auditor blob", () => {
  const raw = u8(92);
  const b64Str = b64(raw);
  const result = validateEncryptedBlob(b64Str, "evidence_auditor_blob");
  assert.equal(result.valid, true);
});

// ── Oversized blobs ──────────────────────────────────────────────────────

test("rejects oversized ciphertext (1 byte over limit)", () => {
  const result = validateEncryptedBlob(
    u8(MAX_CIPHERTEXT_BYTES + 1),
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /exceeding the maximum of 4096/);
});

test("rejects oversized ciphertext (well over limit)", () => {
  const result = validateEncryptedBlob(
    u8(MAX_CIPHERTEXT_BYTES * 2),
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

test("rejects oversized auditor blob", () => {
  const result = validateEncryptedBlob(
    u8(MAX_AUDITOR_BLOB_BYTES + 1),
    "auditor_blob",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /exceeding the maximum of 1024/);
});

test("rejects oversized hex-encoded evidence ciphertext", () => {
  // Hex encoding doubles the byte count: 4097 raw bytes → 8194 hex chars.
  const raw = u8(MAX_CIPHERTEXT_BYTES + 1);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

test("rejects oversized hex-encoded evidence auditor blob", () => {
  const raw = u8(MAX_AUDITOR_BLOB_BYTES + 1);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

// ── Invalid encoding ─────────────────────────────────────────────────────

test("rejects hex string with invalid characters (evidence ciphertext)", () => {
  const result = validateEncryptedBlob(
    "zzz_not_valid_hex_1234",
    "evidence_ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid hex/);
});

test("rejects hex string with odd length (evidence auditor blob)", () => {
  const result = validateEncryptedBlob("abc", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects invalid base64 string (evidence ciphertext)", () => {
  const result = validateEncryptedBlob(
    "!!!invalid-base64!!!",
    "evidence_ciphertext",
    { encoding: "base64" },
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid base64 encoding/);
});

test("accepts 0x-prefixed hex evidence ciphertext", () => {
  const raw = u8(128);
  const result = validateEncryptedBlob("0x" + hex(raw), "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("rejects hex string with 0x prefix explicitly flagged as base64", () => {
  const result = validateEncryptedBlob(
    "0xabcd1234",
    "evidence_ciphertext",
    { encoding: "base64" },
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects base64 string with invalid characters", () => {
  const result = validateEncryptedBlob("AAAA-AAAA", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects string with mixed valid/invalid hex characters", () => {
  const result = validateEncryptedBlob(
    "abcdefggggg", // 'g' is not valid hex
    "evidence_ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

// ── Explicit encoding option tests ───────────────────────────────────────

test("forced hex accepts valid hex and 0x-prefixed hex", () => {
  const raw = u8(32);
  const plainHex = hex(raw);
  const prefixedHex = "0x" + plainHex;

  const res1 = validateEncryptedBlob(plainHex, "evidence_ciphertext", {
    encoding: "hex",
  });
  assert.equal(res1.valid, true);

  const res2 = validateEncryptedBlob(prefixedHex, "evidence_ciphertext", {
    encoding: "hex",
  });
  assert.equal(res2.valid, true);
});

test("forced hex rejects valid base64 strings containing non-hex characters", () => {
  const res = validateEncryptedBlob("dGVzdA==", "evidence_ciphertext", {
    encoding: "hex",
  });
  assert.equal(res.valid, false);
  assert.equal(res.issues[0].code, "invalid_encoding");
});

test("forced base64 accepts valid base64 strings", () => {
  const raw = u8(32);
  const b64Str = b64(raw);
  const res = validateEncryptedBlob(b64Str, "evidence_ciphertext", {
    encoding: "base64",
  });
  assert.equal(res.valid, true);
});

test("forced base64 uses base64 decoder instead of hex", () => {
  // "AAAA" is valid hex (2 bytes: 0xaa, 0xaa) and valid base64 (3 bytes: 0x00, 0x00, 0x00).
  // If forced base64, decoded length is 3 bytes.
  // With maxBytes: 2, forced hex passes (2 bytes <= 2), but forced base64 fails (3 bytes > 2).
  const resHex = validateEncryptedBlob("AAAA", "ciphertext", {
    encoding: "hex",
    maxBytes: 2,
  });
  assert.equal(resHex.valid, true);

  const resB64 = validateEncryptedBlob("AAAA", "ciphertext", {
    encoding: "base64",
    maxBytes: 2,
  });
  assert.equal(resB64.valid, false);
  assert.equal(resB64.issues[0].code, "blob_too_large");
});

test("omitted encoding auto-detects hex first, then base64", () => {
  const raw = u8(16);
  const hexStr = hex(raw);
  const resHex = validateEncryptedBlob(hexStr, "evidence_ciphertext");
  assert.equal(resHex.valid, true);

  // "dGVzdA==" is valid base64 but invalid hex
  const resB64 = validateEncryptedBlob("dGVzdA==", "evidence_ciphertext");
  assert.equal(resB64.valid, true);
});

// ── Invalid type ─────────────────────────────────────────────────────────

test("rejects non-Uint8Array, non-string input", () => {
  const result = validateEncryptedBlob(
    null as unknown as Uint8Array,
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_type");
});

test("rejects number input", () => {
  const result = validateEncryptedBlob(
    12345 as unknown as Uint8Array,
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_type");
});

// ── tryDecodeHex / tryDecodeBase64 unit tests ────────────────────────────

test("tryDecodeHex decodes uppercase", () => {
  const result = tryDecodeHex("ABCD");
  assert.notEqual(result, null);
  assert.equal(result!.length, 2);
  assert.deepEqual([...result!.bytes], [0xab, 0xcd]);
});

test("tryDecodeHex decodes lowercase", () => {
  const result = tryDecodeHex("deadbeef");
  assert.notEqual(result, null);
  assert.equal(result!.length, 4);
});

test("tryDecodeHex handles 0x prefix", () => {
  const result = tryDecodeHex("0xdeadbeef");
  assert.notEqual(result, null);
  assert.equal(result!.length, 4);
});

test("tryDecodeHex rejects invalid characters", () => {
  assert.equal(tryDecodeHex("zzz"), null);
});

test("tryDecodeHex rejects odd length", () => {
  assert.equal(tryDecodeHex("a"), null);
});

test("tryDecodeBase64 decodes a valid string", () => {
  const result = tryDecodeBase64("AAAA");
  assert.notEqual(result, null);
  assert.equal(result!.length, 3);
});

test("tryDecodeBase64 rejects invalid characters", () => {
  assert.equal(tryDecodeBase64("AAAA-AAAA"), null);
});

test("tryDecodeBase64 rejects non-multiple-of-4 length", () => {
  assert.equal(tryDecodeBase64("AAA"), null);
});

// ── Optional maxBytes override ───────────────────────────────────────────

test("respects custom maxBytes override", () => {
  const result = validateEncryptedBlob(u8(100), "ciphertext", {
    maxBytes: 50,
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /100 bytes, exceeding the maximum of 50/);
});

test("custom maxBytes can be more permissive than default", () => {
  const result = validateEncryptedBlob(u8(MAX_CIPHERTEXT_BYTES + 100), "ciphertext", {
    maxBytes: MAX_CIPHERTEXT_BYTES + 200,
  });
  assert.equal(result.valid, true);
});

// ── Sealed-bid acceptance gate ────────────────────────────────────────────
//
// The gate a bid has to pass before it is committed. Three layers, matching
// the sealer: the blob is well-formed tlock ciphertext, its lengths are the
// ones the contract expects, and its commitment is re-derived from the
// supplied value and nonce with tlock's own helper.

/** Assert rejection and return the issue codes, for readable assertions. */
function rejectionCodes(sealed: SealedBid, binding?: SealedBidBinding): string[] {
  const result = validateSealedBid(sealed, binding);
  assert.equal(result.valid, false, "expected the seal to be rejected");
  return result.issues.map((issue) => issue.code);
}

// ── A real seal is accepted ───────────────────────────────────────────────

test("accepts a blob produced by sealBid, with its value, nonce, and round", async () => {
  const sealed = await sealFixture();
  const result = validateSealedBid(sealed, fixtureBinding());

  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assertSealedBid(sealed, fixtureBinding());
});

test("accepts a sealBid blob carrying a selective-disclosure auditor blob", async () => {
  const keypair = generateAuditorKeypair();
  const sealed = await sealFixture({
    identity: new TextEncoder().encode("GBIDDER...alice"),
    auditorPublicKey: keypair.publicKey,
  });
  assert.ok(sealed.auditorBlob.length > 0);

  const result = validateSealedBid(sealed, fixtureBinding());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("accepts a sealBid blob with an empty auditor blob (no identity disclosed)", async () => {
  // `sealBid` emits an empty auditor blob when the bidder discloses nothing,
  // and the contract takes `auditor_blob` as optional Bytes.
  const sealed = await sealFixture();
  assert.equal(sealed.auditorBlob.length, 0);
  assert.equal(validateSealedBid(sealed, fixtureBinding()).valid, true);
});

test("accepts the structural checks alone, without a value, nonce, or round", async () => {
  const sealed = await sealFixture();
  const result = validateSealedBid(sealed);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

// ── Truncated blobs are rejected ──────────────────────────────────────────

test("rejects a truncated ciphertext before commit", async () => {
  const sealed = await sealFixture();
  const truncated = { ...sealed, ciphertext: sealed.ciphertext.slice(0, 120) };
  assert.deepEqual(rejectionCodes(truncated, fixtureBinding()), [
    "invalid_sealed_payload",
  ]);
});

test("rejects a ciphertext whose armor footer was cut off", async () => {
  const sealed = await sealFixture();
  const text = new TextDecoder().decode(sealed.ciphertext);
  const stripped = new TextEncoder().encode(text.replace(/-----END AGE ENCRYPTED FILE-----\n?$/, ""));
  assert.ok(rejectionCodes({ ...sealed, ciphertext: stripped }, fixtureBinding()).includes(
    "invalid_sealed_payload",
  ));
});

test("rejects an empty ciphertext", async () => {
  const sealed = await sealFixture();
  assert.ok(rejectionCodes({ ...sealed, ciphertext: new Uint8Array(0) }, fixtureBinding()).includes(
    "empty_blob",
  ));
});

test("rejects an oversized ciphertext", async () => {
  const sealed = await sealFixture();
  const padded = new Uint8Array(MAX_CIPHERTEXT_BYTES + 1).fill(0x61);
  assert.ok(rejectionCodes({ ...sealed, ciphertext: padded }, fixtureBinding()).includes(
    "blob_too_large",
  ));
});

test("rejects a blob that is not a tlock payload at all", async () => {
  const sealed = await sealFixture();
  const codes = rejectionCodes(
    { ...sealed, ciphertext: new TextEncoder().encode("age-encryption.org/v1\nnot armored\n") },
    fixtureBinding(),
  );
  assert.ok(codes.includes("invalid_sealed_payload"));
});

// ── Length ────────────────────────────────────────────────────────────────

test("rejects a commitment that is not 32 bytes", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(
    rejectionCodes({ ...sealed, commitment: sealed.commitment.slice(0, 31) }, fixtureBinding()),
    ["invalid_commitment_length"],
  );
  assert.deepEqual(
    rejectionCodes({ ...sealed, commitment: new Uint8Array(33) }, fixtureBinding()),
    ["invalid_commitment_length"],
  );
});

test("rejects a nonce that is not 32 bytes", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(
    rejectionCodes(sealed, fixtureBinding({ nonce: new Uint8Array(31) })),
    ["invalid_nonce_length"],
  );
});

test("rejects an oversized auditor blob", async () => {
  const sealed = await sealFixture();
  const codes = rejectionCodes(
    { ...sealed, auditorBlob: new Uint8Array(MAX_AUDITOR_BLOB_BYTES + 1) },
    fixtureBinding(),
  );
  assert.ok(codes.includes("blob_too_large"));
});

// ── A commitment that does not match the value is rejected ────────────────

test("rejects a blob whose commitment does not match the value", async () => {
  const sealed = await sealFixture();
  // The caller believes they bid 1 more stroop than they sealed.
  const codes = rejectionCodes(sealed, fixtureBinding({ value: BID_VALUE + 1n }));
  assert.deepEqual(codes, ["commitment_mismatch"]);
});

test("rejects a blob whose commitment does not match the nonce", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(
    rejectionCodes(sealed, fixtureBinding({ nonce: new Uint8Array(32).fill(0x99) })),
    ["commitment_mismatch"],
  );
});

test("rejects a swapped blob: one bidder's ciphertext with another's commitment", async () => {
  const aliceNonce = new Uint8Array(32).fill(1);
  const bobNonce = new Uint8Array(32).fill(2);
  const alice = await sealFixture({ value: 700n, nonce: aliceNonce });
  const bob = await sealFixture({ value: 900n, nonce: bobNonce });
  const swapped: SealedBid = { ...alice, commitment: bob.commitment };

  // Alice's ciphertext is structurally perfect, so the encoding and length
  // layers pass it. Only re-deriving the commitment from the value and nonce
  // the caller actually sealed catches the substitution.
  assert.equal(validateSealedBid(swapped).valid, true);
  assert.deepEqual(
    rejectionCodes(swapped, { value: 700n, nonce: aliceNonce, round: BID_ROUND }),
    ["commitment_mismatch"],
  );
});

test("documents the swap boundary: a self-consistent wrong binding is not detectable", async () => {
  const aliceNonce = new Uint8Array(32).fill(1);
  const bobNonce = new Uint8Array(32).fill(2);
  const alice = await sealFixture({ value: 700n, nonce: aliceNonce });
  const bob = await sealFixture({ value: 900n, nonce: bobNonce });
  const swapped: SealedBid = { ...alice, commitment: bob.commitment };

  // Honest limit of an offline gate. If the caller hands the gate bob's value
  // and nonce, the commitment does match them, and the blob passes — because
  // the only way to notice that alice's ciphertext is hiding something else is
  // to decrypt it, and the seal is timelocked. This is not a gap the check can
  // close; it is the guarantee the seal is built on. What the gate does
  // guarantee is that a *self-consistent* value/nonce/commitment triple is what
  // gets committed, so the reveal can only fail for the contract's own reasons.
  assert.equal(
    validateSealedBid(swapped, { value: 900n, nonce: bobNonce, round: BID_ROUND }).valid,
    true,
  );
  // The caller's own inputs are the attack surface, so they are echoed nowhere
  // even when the blob is rejected: the mismatch message names neither side.
  const result = validateSealedBid(swapped, { value: 1n, nonce: aliceNonce, round: BID_ROUND });
  assert.equal(result.valid, false);
  assert.ok(!result.issues.some((i) => i.message.includes("700")));
  assert.ok(!result.issues.some((i) => i.message.includes("900")));
});

test("rejects another round's commitment substituted for this bid's", async () => {
  const mine = await sealFixture({ value: 700n, nonce: new Uint8Array(32).fill(1) });
  const other = await sealFixture({ value: 700n, nonce: new Uint8Array(32).fill(1), round: BID_ROUND + 1 });
  // Same value and nonce, so only the round differs — the commitment is equal.
  assert.deepEqual([...mine.commitment], [...other.commitment]);
  assert.deepEqual(
    rejectionCodes({ ...mine, commitment: other.commitment.slice().reverse() }, {
      value: 700n,
      nonce: new Uint8Array(32).fill(1),
      round: BID_ROUND,
    }),
    ["commitment_mismatch"],
  );
});

// ── Cross-round blobs are rejected ────────────────────────────────────────

test("rejects a blob sealed to a different drand round", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(rejectionCodes(sealed, fixtureBinding({ round: BID_ROUND + 1 })), [
    "round_mismatch",
  ]);
  assert.deepEqual(rejectionCodes(sealed, fixtureBinding({ round: 1 })), ["round_mismatch"]);
});

test("rejects a blob bound to a different drand chain", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(rejectionCodes(sealed, fixtureBinding({ chainHash: "a".repeat(64) })), [
    "chain_mismatch",
  ]);
  // The contract verifies quicknet, so quicknet is the default expectation.
  assert.equal(validateSealedBid(sealed, fixtureBinding({ chainHash: QUICKNET_HASH })).valid, true);
});

// ── The bid value never reaches the error ─────────────────────────────────

test("the error text does not contain the fixture bid", async () => {
  const sealed = await sealFixture();

  // Every rejection path is exercised, and none of them may echo the value.
  const rejected: Array<{ sealed: SealedBid; binding?: SealedBidBinding }> = [
    { sealed, binding: fixtureBinding({ value: BID_VALUE + 1n }) },
    { sealed, binding: fixtureBinding({ nonce: new Uint8Array(32).fill(0x99) }) },
    { sealed, binding: fixtureBinding({ nonce: new Uint8Array(31) }) },
    { sealed, binding: fixtureBinding({ round: BID_ROUND + 1 }) },
    { sealed, binding: fixtureBinding({ chainHash: "a".repeat(64) }) },
    { sealed: { ...sealed, ciphertext: sealed.ciphertext.slice(0, 120) }, binding: fixtureBinding() },
    { sealed: { ...sealed, commitment: sealed.commitment.slice(0, 31) }, binding: fixtureBinding() },
  ];

  for (const { sealed: bad, binding } of rejected) {
    const result = validateSealedBid(bad, binding);
    assert.equal(result.valid, false, "expected rejection");
    for (const issue of result.issues) {
      assert.ok(
        !issue.message.includes(BID_VALUE.toString()),
        `message leaked the bid: ${issue.message}`,
      );
      assert.ok(
        !issue.message.includes(BID_VALUE.toString(16)),
        `message leaked the bid in hex: ${issue.message}`,
      );
    }
  }
});

test("assertSealedBid throws a typed error whose message omits the bid", async () => {
  const sealed = await sealFixture();
  assert.throws(
    () => assertSealedBid(sealed, fixtureBinding({ value: BID_VALUE + 1n })),
    (error: unknown) => {
      assert.ok(error instanceof SubRosaClientConfigError);
      assert.match(error.message, /commitment does not match/);
      assert.ok(!error.message.includes(BID_VALUE.toString()));
      return true;
    },
  );
});

test("assertSealedBid reports every defect at once", async () => {
  const sealed = await sealFixture();
  const codes = (() => {
    try {
      assertSealedBid(
        { ...sealed, ciphertext: sealed.ciphertext.slice(0, 120) },
        fixtureBinding({ value: BID_VALUE + 1n }),
      );
      return [];
    } catch (error) {
      assert.ok(error instanceof SubRosaClientConfigError);
      return error.message.split("; ");
    }
  })();
  assert.ok(codes.length >= 2, "expected both the payload and the binding defect");
});

// ── The gate agrees with tlock's own helper ───────────────────────────────

test("the accepted set is exactly the set tlock's commitment helper agrees with", async () => {
  const sealed = await sealFixture();
  // The gate must not be a second, drifting definition of "this is the bid":
  // it has to accept precisely when tlock derives the same H.
  for (const value of [BID_VALUE - 1n, BID_VALUE, BID_VALUE + 1n]) {
    const agrees = bytesEqual(sealed.commitment, commitment(value, BID_NONCE));
    const accepted = validateSealedBid(sealed, fixtureBinding({ value })).valid;
    assert.equal(accepted, agrees, `value ${value}: accepted=${accepted} agrees=${agrees}`);
  }
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

test("forced hex does not fall back to base64", () => {
  const result = validateEncryptedBlob("/w==", "ciphertext", { encoding: "hex" });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid hex encoding/);
});
test("forced base64 does not fall back to hex", () => {
  const result = validateEncryptedBlob("ff", "ciphertext", { encoding: "base64" });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid base64 encoding/);
});
test("ambiguous text uses the requested decoder for the decoded size limit", () => {
  assert.equal(validateEncryptedBlob("deadbeef", "ciphertext", { encoding: "hex", maxBytes: 4 }).valid, true);
  const base64 = validateEncryptedBlob("deadbeef", "ciphertext", { encoding: "base64", maxBytes: 4 });
  assert.equal(base64.valid, false);
  assert.equal(base64.issues[0].code, "blob_too_large");
  assert.equal(validateEncryptedBlob("deadbeef", "ciphertext", { maxBytes: 4 }).valid, true);
});
test("explicit decoders accept their valid input and auto-detection accepts both", () => {
  for (const [blob, encoding] of [["0xff", "hex"], ["/w==", "base64"]] as const) {
    assert.equal(validateEncryptedBlob(blob, "ciphertext", { encoding }).valid, true);
    assert.equal(validateEncryptedBlob(blob, "ciphertext").valid, true);
  }
});
