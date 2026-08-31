// Versioned payload envelope for partner-defined sealed submissions.
//
// V1 layout (all integers big-endian):
//
//   magic(4) | version(1) | flags(1) | reserved(2) |
//   amount(16) | nonce(32) | payload_len(4) | payload(N)
//
// `amount` is optional and its presence is encoded in flags bit 0. The complete
// envelope is hashed and timelock-encrypted, so every application payload byte
// is commitment-bound. The deployed v1 bid format remains available separately
// through sealBid/openBid.

import { sha256 } from "@noble/hashes/sha2.js";
import { timelockDecrypt, timelockEncrypt, Buffer as TlockBuffer } from "tlock-js";

import { sealIdentity } from "./auditor.js";
import { beBytesToI128, i128ToBeBytes, NONCE_BYTES, VALUE_BYTES } from "./commitment.js";
import type { DrandClient } from "./quicknet.js";

const utf8Encode = new TextEncoder();
const utf8Decode = new TextDecoder();

const MAGIC = new Uint8Array([0x53, 0x52, 0x50, 0x00]); // "SRP\0"
const FLAG_AMOUNT = 1 << 0;
const SUPPORTED_FLAGS = FLAG_AMOUNT;
const VERSION_OFFSET = 4;
const FLAGS_OFFSET = 5;
const RESERVED_OFFSET = 6;
const AMOUNT_OFFSET = 8;
const NONCE_OFFSET = AMOUNT_OFFSET + VALUE_BYTES;
const LENGTH_OFFSET = NONCE_OFFSET + NONCE_BYTES;

export const PAYLOAD_ENVELOPE_VERSION = 1;
export const PAYLOAD_HEADER_BYTES = LENGTH_OFFSET + 4;
// Keeps the age-armored tlock ciphertext comfortably below the current
// contract's 4096-byte ciphertext ceiling once Core v2 consumes this format.
export const MAX_APPLICATION_PAYLOAD_BYTES = 2048;

export interface PayloadEnvelope {
  /** Optional economic amount used by auction/procurement templates. */
  amount?: bigint;
  /** Application-defined bytes, interpreted using the round's schema. */
  payload: Uint8Array;
  /** 32 random bytes; use generateNonce() from the package. */
  nonce: Uint8Array;
}

export interface SealPayloadParams extends PayloadEnvelope {
  round: number;
  client: DrandClient;
  identity?: Uint8Array;
  auditorPublicKey?: Uint8Array;
}

export interface SealedPayload {
  version: typeof PAYLOAD_ENVELOPE_VERSION;
  commitment: Uint8Array;
  ciphertext: Uint8Array;
  auditorBlob: Uint8Array;
}

function assertEnvelopeInput(envelope: PayloadEnvelope): void {
  if (envelope.nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes, got ${envelope.nonce.length}`);
  }
  if (envelope.payload.length > MAX_APPLICATION_PAYLOAD_BYTES) {
    throw new Error(
      `payload must be at most ${MAX_APPLICATION_PAYLOAD_BYTES} bytes, got ${envelope.payload.length}`,
    );
  }
  if (envelope.amount !== undefined) i128ToBeBytes(envelope.amount);
}

/** Encode the canonical bytes Core v2 will hash during reveal. */
export function encodePayloadEnvelope(envelope: PayloadEnvelope): Uint8Array {
  assertEnvelopeInput(envelope);

  const out = new Uint8Array(PAYLOAD_HEADER_BYTES + envelope.payload.length);
  out.set(MAGIC, 0);
  out[VERSION_OFFSET] = PAYLOAD_ENVELOPE_VERSION;
  out[FLAGS_OFFSET] = envelope.amount === undefined ? 0 : FLAG_AMOUNT;
  if (envelope.amount !== undefined) {
    out.set(i128ToBeBytes(envelope.amount), AMOUNT_OFFSET);
  }
  out.set(envelope.nonce, NONCE_OFFSET);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
    LENGTH_OFFSET,
    envelope.payload.length,
    false,
  );
  out.set(envelope.payload, PAYLOAD_HEADER_BYTES);
  return out;
}

/** Decode and strictly validate a canonical V1 payload envelope. */
export function decodePayloadEnvelope(bytes: Uint8Array): PayloadEnvelope {
  if (bytes.length < PAYLOAD_HEADER_BYTES) {
    throw new Error(
      `payload envelope must be at least ${PAYLOAD_HEADER_BYTES} bytes, got ${bytes.length}`,
    );
  }
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error("invalid payload envelope magic");
  }
  if (bytes[VERSION_OFFSET] !== PAYLOAD_ENVELOPE_VERSION) {
    throw new Error(`unsupported payload envelope version ${bytes[VERSION_OFFSET]}`);
  }

  const flags = bytes[FLAGS_OFFSET];
  if ((flags & ~SUPPORTED_FLAGS) !== 0) {
    throw new Error(`unsupported payload envelope flags 0x${flags.toString(16)}`);
  }
  if (bytes[RESERVED_OFFSET] !== 0 || bytes[RESERVED_OFFSET + 1] !== 0) {
    throw new Error("payload envelope reserved bytes must be zero");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadLength = view.getUint32(LENGTH_OFFSET, false);
  if (payloadLength > MAX_APPLICATION_PAYLOAD_BYTES) {
    throw new Error(
      `payload must be at most ${MAX_APPLICATION_PAYLOAD_BYTES} bytes, got ${payloadLength}`,
    );
  }
  if (bytes.length !== PAYLOAD_HEADER_BYTES + payloadLength) {
    throw new Error(
      `payload envelope length mismatch: header declares ${payloadLength}, got ${bytes.length - PAYLOAD_HEADER_BYTES}`,
    );
  }

  const amountBytes = bytes.slice(AMOUNT_OFFSET, NONCE_OFFSET);
  const hasAmount = (flags & FLAG_AMOUNT) !== 0;
  if (!hasAmount && amountBytes.some((byte) => byte !== 0)) {
    throw new Error("payload envelope without amount must use a zero amount field");
  }

  return {
    ...(hasAmount ? { amount: beBytesToI128(amountBytes) } : {}),
    nonce: bytes.slice(NONCE_OFFSET, LENGTH_OFFSET),
    payload: bytes.slice(PAYLOAD_HEADER_BYTES),
  };
}

/** Domain-separated commitment to every byte in the V1 envelope. */
export function payloadCommitment(envelope: PayloadEnvelope): Uint8Array {
  return sha256(encodePayloadEnvelope(envelope));
}

/** Timelock-encrypt a structured application payload to Drand round R. */
export async function sealPayload(params: SealPayloadParams): Promise<SealedPayload> {
  const {
    round,
    client,
    identity,
    auditorPublicKey,
    amount,
    nonce,
    payload,
  } = params;
  const envelope: PayloadEnvelope = {
    ...(amount === undefined ? {} : { amount }),
    nonce,
    payload,
  };
  const encoded = encodePayloadEnvelope(envelope);
  const armored = await timelockEncrypt(round, TlockBuffer.from(encoded), client);

  let auditorBlob = new Uint8Array(0);
  if (identity && auditorPublicKey) {
    auditorBlob = new Uint8Array(sealIdentity(identity, auditorPublicKey));
  } else if (identity || auditorPublicKey) {
    throw new Error("identity and auditorPublicKey must be provided together");
  }

  return {
    version: PAYLOAD_ENVELOPE_VERSION,
    commitment: sha256(encoded),
    ciphertext: utf8Encode.encode(armored),
    auditorBlob,
  };
}

/** Open and validate a V1 structured payload after Drand round R. */
export async function openPayload(
  ciphertext: Uint8Array,
  client: DrandClient,
): Promise<PayloadEnvelope> {
  const armored = utf8Decode.decode(ciphertext);
  const plaintext = await timelockDecrypt(armored, client);
  return decodePayloadEnvelope(Uint8Array.from(plaintext));
}
