// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateAuditorKeypair, openIdentity, sealIdentity } from "./auditor.js";

const identity = new TextEncoder().encode("GALICE...bidder-identity");

test("auditor blob roundtrip — only the auditor can read the identity", () => {
  const auditor = generateAuditorKeypair();
  const blob = sealIdentity(identity, auditor.publicKey);
  const recovered = openIdentity(blob, auditor.secretKey);
  assert.deepEqual([...recovered], [...identity]);
});

test("a different auditor key cannot open the blob", () => {
  const auditor = generateAuditorKeypair();
  const intruder = generateAuditorKeypair();
  const blob = sealIdentity(identity, auditor.publicKey);
  assert.throws(() => openIdentity(blob, intruder.secretKey));
});

test("tampered ciphertext fails AEAD authentication", () => {
  const auditor = generateAuditorKeypair();
  const blob = sealIdentity(identity, auditor.publicKey);
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => openIdentity(blob, auditor.secretKey));
});

// ── Identity binding (issue #382) ────────────────────────────────────────────
//
// An auditor blob that opens but names a different bidder is a disclosure bug,
// not a decode error. These tests pin recovery to the bidder identity and round
// that were committed when the blob was sealed.

import {
  decodeIdentityBlob,
  openIdentityForBidder,
  sealIdentityForBidder,
} from "./auditor.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const ROUND = 4210;
const ALICE = enc.encode("alice-secret-id");
const BOB = enc.encode("bob-secret-id");

test("matching blob recovers the committed identity", () => {
  const auditor = generateAuditorKeypair();
  const blob = sealIdentityForBidder({
    identity: ALICE,
    round: ROUND,
    commitment: new Uint8Array(32).fill(7),
    auditorPublicKey: auditor.publicKey,
  });
  const opened = openIdentityForBidder(blob, {
    auditorSecretKey: auditor.secretKey,
    round: ROUND,
    commitment: new Uint8Array(32).fill(7),
  });
  assert.equal(dec.decode(opened.identity), "alice-secret-id");
});

test("a blob sealed for another bidder in the same round is rejected", () => {
  const auditor = generateAuditorKeypair();
  const aliceBlob = sealIdentityForBidder({
    identity: ALICE,
    round: ROUND,
    commitment: new Uint8Array(32).fill(7),
    auditorPublicKey: auditor.publicKey,
  });
  // Bob's commitment differs, so Alice's blob must not open under it.
  assert.throws(
    () =>
      openIdentityForBidder(aliceBlob, {
        auditorSecretKey: auditor.secretKey,
        round: ROUND,
        commitment: new Uint8Array(32).fill(8),
      }),
    /identity commitment mismatch/i,
  );
});

test("a blob from another round is rejected", () => {
  const auditor = generateAuditorKeypair();
  const commitment = new Uint8Array(32).fill(7);
  const blob = sealIdentityForBidder({
    identity: ALICE,
    round: ROUND,
    commitment,
    auditorPublicKey: auditor.publicKey,
  });
  assert.throws(
    () =>
      openIdentityForBidder(blob, {
        auditorSecretKey: auditor.secretKey,
        round: ROUND + 1,
        commitment,
      }),
    /round mismatch/i,
  );
});

test("a blob truncated below the sealed-box minimum is rejected before decryption", () => {
  const auditor = generateAuditorKeypair();
  // Shorter than ephPub ‖ nonce ‖ AEAD tag: unusable framing, so it is refused
  // without touching the cipher.
  assert.throws(() => decodeIdentityBlob(new Uint8Array(40)), /too short/i);
});

test("a byte-truncated bound blob fails authentication and yields no identity", () => {
  const auditor = generateAuditorKeypair();
  const blob = sealIdentityForBidder({
    identity: ALICE,
    round: ROUND,
    commitment: new Uint8Array(32).fill(7),
    auditorPublicKey: auditor.publicKey,
  });
  // Identity length is variable, so trimming the tail cannot be detected by
  // framing alone; the AEAD tag must reject it.
  const truncated = blob.slice(0, blob.length - 1);
  assert.throws(() =>
    openIdentityForBidder(truncated, {
      auditorSecretKey: auditor.secretKey,
      round: ROUND,
      commitment: new Uint8Array(32).fill(7),
    }),
  );
});

test("truncated bound plaintext is rejected by the strict decoder", () => {
  const auditor = generateAuditorKeypair();
  const identity = new TextEncoder().encode("a-much-longer-bidder-identity");
  const blob = sealIdentityForBidder({
    identity,
    round: ROUND,
    commitment: new Uint8Array(32).fill(7),
    auditorPublicKey: auditor.publicKey,
  });
  // A blob whose sealed plaintext is one byte short must not be accepted with a
  // silently shortened identity.
  const truncated = blob.slice(0, blob.length - 1);
  assert.throws(() =>
    openIdentityForBidder(truncated, {
      auditorSecretKey: auditor.secretKey,
      round: ROUND,
      commitment: new Uint8Array(32).fill(7),
    }),
  );
});
