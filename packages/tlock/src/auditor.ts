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

import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";

const EPH_PUB_BYTES = 32;
const NONCE_BYTES = 24;
const HKDF_INFO = new TextEncoder().encode("sub-rosa/auditor-blob/v1");

export interface AuditorKeypair {
  secretKey: Uint8Array; // 32-byte X25519 scalar
  publicKey: Uint8Array; // 32-byte X25519 public key
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
