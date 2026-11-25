// SPDX-License-Identifier: MIT
// sealBid / openBid — the off-chain seal.
//
// sealBid timelock-encrypts the exact commitment preimage (be16(value)‖nonce) to
// a Drand round R and returns everything the contract `commit` needs: the
// commitment H, the ciphertext C, and the auditor identity blob. openBid is the
// inverse, runnable by anyone once R is published — which is what makes the
// reveal unstoppable.

import { timelockEncrypt, timelockDecrypt, Buffer as TlockBuffer } from "tlock-js";
import { randomBytes } from "@noble/hashes/utils.js";

import { commitment, decodeBidPreimage, encodeBidPreimage, NONCE_BYTES } from "./commitment.js";
import { sealIdentityForBidder } from "./auditor.js";
import type { DrandClient } from "./quicknet.js";
import { assertContractId, assertBidderId } from "./validate.js";

const utf8Encode = new TextEncoder();
const utf8Decode = new TextDecoder();

export interface SealBidParams {
  contractId: string;
  bidderId: string;
  value: bigint;
  nonce: Uint8Array;
  round: number;
  client: DrandClient;
  /// The Drand round the auction committed to open (`Round::reveal_round`).
  /// The seal must name exactly this round, or sealing is rejected.
  revealRound: number;
  /// Optional selective-disclosure identity, sealed to the auditor key.
  identity?: Uint8Array;
  auditorPublicKey?: Uint8Array;
}

export interface SealedBid {
  /// H = sha256(be16(value)‖nonce) — pass to the contract `commit`.
  commitment: Uint8Array;
  /// C = tlock(preimage, R) as UTF-8 bytes of the age-armored ciphertext.
  ciphertext: Uint8Array;
  /// enc(identity, auditor_pubkey); empty if no identity was provided.
  auditorBlob: Uint8Array;
  /// The Drand round this seal was encrypted to. The SDK forwards it to the
  /// contract `commit` as `seal_round`, where it must equal the auction's
  /// stored `reveal_round` (issue #376).
  sealRound: number;
}

export function generateNonce(): Uint8Array {
  return randomBytes(NONCE_BYTES);
}

export async function sealBid(params: SealBidParams): Promise<SealedBid> {
  const { contractId, bidderId, value, nonce, round, client, identity, auditorPublicKey } = params;

  assertContractId(contractId);
  assertBidderId(bidderId);

  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError(`round must be a positive integer, got ${round}`);
  }
  if (!nonce || nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes, got ${nonce?.length}`);
  }
  // Issue #376: the seal must name exactly the round the auction committed to
  // open — same rule the contract enforces inside `commit`.
  assertSealRoundWindow(round, revealRound);

  const preimage = encodeBidPreimage(value, nonce);
  const h = commitment(value, nonce);
  const armored = await timelockEncrypt(round, TlockBuffer.from(preimage), client);
  const ciphertext = new Uint8Array(utf8Encode.encode(armored));

  let auditorBlob = new Uint8Array(0);
  if (identity && auditorPublicKey) {
    // Bind the blob to this bid: the auditor can then prove the recovered
    // identity is the one committed with the seal, not a swapped blob from
    // another bidder (issue #382).
    auditorBlob = new Uint8Array(
      sealIdentityForBidder({ identity, round, commitment: h, auditorPublicKey }),
    );
  } else if (identity || auditorPublicKey) {
    throw new Error("identity and auditorPublicKey must be provided together");
  }

  return { commitment: h, ciphertext, auditorBlob, sealRound: round };
}

export interface OpenedBid {
  value: bigint;
  nonce: Uint8Array;
}

/// Decrypt a sealed bid once round R is available. Throws if R has not yet been
/// published (the seal is still closed) or the ciphertext is malformed.
export async function openBid(
  ciphertext: Uint8Array,
  client: DrandClient,
): Promise<OpenedBid> {
  if (!ciphertext || ciphertext.length === 0) {
    throw new Error("ciphertext is empty; ciphertext must not be empty");
  }
  const armored = utf8Decode.decode(ciphertext);
  const plaintext = await timelockDecrypt(armored, client);
  return decodeBidPreimage(Uint8Array.from(plaintext));
}
