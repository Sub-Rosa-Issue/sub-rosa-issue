// Offline sealed-bid fixtures for the SDK tests.
//
// A real seal, produced without a network. `timelockEncrypt` reads exactly one
// thing from the Drand client — `chain().info()` — and only to learn the
// chain's static public key, which is a constant of quicknet. Stubbing that
// call therefore yields genuine tlock ciphertext, so the pre-commit gate is
// tested against the real sealer instead of a hand-written stand-in that could
// drift from it.
//
// This is test-only scaffolding: it is not exported from the package index, and
// nothing in `src` outside `*.test.ts` imports it.

import {
  QUICKNET_HASH,
  NONCE_BYTES,
  sealBid,
  type DrandClient,
  type SealedBid,
} from "@sub-rosa/tlock";
import type { SealedBidBinding } from "../encrypted-blob.js";

/** quicknet's real chain public key. */
const QUICKNET_PUBLIC_KEY =
  "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";

const offlineClient = {
  chain: () => ({
    info: async () => ({
      hash: QUICKNET_HASH,
      public_key: QUICKNET_PUBLIC_KEY,
      schemeID: "bls-unchained-g1-rfc9380",
    }),
  }),
} as unknown as DrandClient;

/** The default fixture bid. Distinctive, so tests can assert it never leaks. */
export const BID_VALUE = 8_675_309n;
export const BID_NONCE = new Uint8Array(NONCE_BYTES).fill(0x2a);
export const BID_ROUND = 1_234_567;

/** Seal a bid offline. Each call re-encrypts, so ciphertexts differ per call. */
export function sealFixture(overrides?: {
  value?: bigint;
  nonce?: Uint8Array;
  round?: number;
  identity?: Uint8Array;
  auditorPublicKey?: Uint8Array;
}): Promise<SealedBid> {
  return sealBid({
    value: overrides?.value ?? BID_VALUE,
    nonce: overrides?.nonce ?? BID_NONCE,
    round: overrides?.round ?? BID_ROUND,
    client: offlineClient,
    ...(overrides?.identity ? { identity: overrides.identity } : {}),
    ...(overrides?.auditorPublicKey
      ? { auditorPublicKey: overrides.auditorPublicKey }
      : {}),
  });
}

/** The binding a fixture seal is expected to satisfy. */
export function fixtureBinding(
  overrides?: Partial<SealedBidBinding>,
): SealedBidBinding {
  return {
    value: BID_VALUE,
    nonce: BID_NONCE,
    round: BID_ROUND,
    ...overrides,
  };
}
