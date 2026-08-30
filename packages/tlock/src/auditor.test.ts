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
