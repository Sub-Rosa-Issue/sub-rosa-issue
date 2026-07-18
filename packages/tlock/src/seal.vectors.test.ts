// Cross-implementation golden vectors for sealBid.
//
// The Round contract stores H = sha256(be16(value) ‖ nonce) as the commitment
// binding, and the tlock ciphertext seals the exact preimage. A silent change
// to the encoding (byte order, nonce length, hash choice) would corrupt every
// sealed bid without any test failing on the Rust side alone. This file pins
// the byte-for-byte fixture the SDK must produce and verifies the auditor blob
// roundtrips under a fixed keypair.
//
// The tlock ciphertext itself is not byte-deterministic (age uses a random
// file key and the IBE ciphertext embeds an ephemeral G1 point), so we only
// pin the deterministic outputs: the preimage encoding, the commitment digest,
// and the auditor-blob decryption path.
//
// How to regenerate ../vectors/seal-bid.json:
//   1. Change `input` and/or `auditor.seed`.
//   2. Recompute derived fields:
//        auditor.secret_key_hex  = sha256(utf8(auditor.seed))
//        auditor.public_key_hex  = x25519.getPublicKey(secret_key_hex)
//        expected.preimage_hex   = encodeBidPreimage(input.value, input.nonce_hex)
//        expected.commitment_hex = sha256(expected.preimage_hex)
//   3. `pnpm --filter @sub-rosa/tlock test:vectors` — the assertions below
//      will surface any mismatch with the recomputed values.
//
// Keep the `expected.commitment_hex` in sync with the Rust vector in
// `contracts/round/src/test.rs::commitment_matches_offchain_vector` — the two
// are the single source of truth that off-chain H == on-chain H.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ChainClient, ChainInfo } from "drand-client";

import {
  commitment,
  encodeBidPreimage,
  fromHex,
  toHex,
} from "./commitment.js";
import { auditorPublicKey, openIdentity } from "./auditor.js";
import { sealBid } from "./seal.js";
import type { DrandClient } from "./quicknet.js";

interface SealBidVector {
  input: {
    value: string;
    nonce_hex: string;
    round: number;
    identity_utf8: string;
  };
  auditor: {
    secret_key_hex: string;
    public_key_hex: string;
  };
  expected: {
    preimage_hex: string;
    commitment_hex: string;
  };
}

const VECTOR_PATH = new URL("../vectors/seal-bid.json", import.meta.url);
const VECTOR: SealBidVector = JSON.parse(readFileSync(VECTOR_PATH, "utf8"));

// Frozen quicknet chain info — matches the fixture in quicknet.test.ts, so the
// vector test does not touch the network. tlock's createTimelockEncrypter only
// reads chain().info(); latest()/get() are never invoked on the encrypt path.
const QUICKNET_INFO: ChainInfo = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};

function offlineQuicknet(): DrandClient {
  const chain = {
    baseUrl: "offline://quicknet-fixture",
    async info(): Promise<ChainInfo> {
      return QUICKNET_INFO;
    },
  };
  const client: ChainClient = {
    options: { disableBeaconVerification: true, noCache: true },
    chain: () => chain,
    latest: async () => {
      throw new Error("offlineQuicknet: latest() not available");
    },
    get: async () => {
      throw new Error("offlineQuicknet: get() not available");
    },
  };
  return client as unknown as DrandClient;
}

test("golden vector: preimage and commitment digest match the frozen fixture", () => {
  const value = BigInt(VECTOR.input.value);
  const nonce = fromHex(VECTOR.input.nonce_hex);

  assert.equal(toHex(encodeBidPreimage(value, nonce)), VECTOR.expected.preimage_hex);
  assert.equal(toHex(commitment(value, nonce)), VECTOR.expected.commitment_hex);
});

test("golden vector: auditor public key matches secret_key_hex under x25519", () => {
  const derived = auditorPublicKey(fromHex(VECTOR.auditor.secret_key_hex));
  assert.equal(toHex(derived), VECTOR.auditor.public_key_hex);
});

test("re-sealing with the fixture inputs reproduces the fixture commitment", async () => {
  const value = BigInt(VECTOR.input.value);
  const nonce = fromHex(VECTOR.input.nonce_hex);
  const identity = new TextEncoder().encode(VECTOR.input.identity_utf8);
  const auditorSecret = fromHex(VECTOR.auditor.secret_key_hex);
  const auditorPub = fromHex(VECTOR.auditor.public_key_hex);

  const sealed = await sealBid({
    value,
    nonce,
    round: VECTOR.input.round,
    client: offlineQuicknet(),
    identity,
    auditorPublicKey: auditorPub,
  });

  // The on-chain binding must be byte-for-byte identical across implementations.
  assert.equal(toHex(sealed.commitment), VECTOR.expected.commitment_hex);

  // The auditor blob is non-deterministic (random ephemeral X25519 key + AEAD
  // nonce), so we assert the roundtrip: the fixture auditor secret recovers the
  // fixture identity byte-for-byte.
  assert.ok(sealed.auditorBlob.length > 0, "auditor blob should be populated");
  const recovered = openIdentity(sealed.auditorBlob, auditorSecret);
  assert.deepEqual([...recovered], [...identity]);
});

test("modifying a single nonce byte changes the binding hash", () => {
  const value = BigInt(VECTOR.input.value);
  const nonce = fromHex(VECTOR.input.nonce_hex);
  const tampered = new Uint8Array(nonce);
  tampered[0] ^= 0x01;

  assert.notEqual(
    toHex(commitment(value, tampered)),
    VECTOR.expected.commitment_hex,
  );
});
