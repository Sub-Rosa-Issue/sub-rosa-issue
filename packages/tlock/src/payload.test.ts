import assert from "node:assert/strict";
import { test } from "node:test";

import { toHex } from "./commitment.js";
import {
  decodePayloadEnvelope,
  encodePayloadEnvelope,
  MAX_APPLICATION_PAYLOAD_BYTES,
  payloadCommitment,
  PAYLOAD_HEADER_BYTES,
  type PayloadEnvelope,
} from "./payload.js";

const text = new TextEncoder();
const nonce = new Uint8Array(32).fill(0x11);
const proposal = text.encode(
  '{"price":"12000 USDC","timeline":"4 weeks","approach":"manual Soroban review"}',
);
const FROZEN_V1_COMMITMENT =
  "da33045ed42f66f5bde3af1434b662de48af036c4040731b12f003d425e6e8d2";

test("V1 payload envelope deterministically binds amount, nonce, and application bytes", () => {
  const input: PayloadEnvelope = { amount: 12_000_0000000n, nonce, payload: proposal };
  const first = encodePayloadEnvelope(input);
  const second = encodePayloadEnvelope(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, PAYLOAD_HEADER_BYTES + proposal.length);
  assert.equal(toHex(first.slice(0, 4)), "53525000"); // SRP\0

  const opened = decodePayloadEnvelope(first);
  assert.equal(opened.amount, input.amount);
  assert.deepEqual(opened.nonce, nonce);
  assert.deepEqual(opened.payload, proposal);
  assert.equal(toHex(payloadCommitment(input)), FROZEN_V1_COMMITMENT);
});

test("amount is optional and canonically represented", () => {
  const encoded = encodePayloadEnvelope({ nonce, payload: proposal });
  const opened = decodePayloadEnvelope(encoded);

  assert.equal(opened.amount, undefined);
  assert.deepEqual(opened.payload, proposal);
});

test("commitment changes when any bound field changes", () => {
  const base: PayloadEnvelope = { amount: 50n, nonce, payload: proposal };
  const h = toHex(payloadCommitment(base));

  assert.notEqual(h, toHex(payloadCommitment({ ...base, amount: 51n })));
  assert.notEqual(
    h,
    toHex(payloadCommitment({ ...base, nonce: new Uint8Array(32).fill(0x12) })),
  );
  assert.notEqual(
    h,
    toHex(payloadCommitment({ ...base, payload: text.encode("different proposal") })),
  );
});

test("decoder rejects malformed or non-canonical envelopes", () => {
  const valid = encodePayloadEnvelope({ nonce, payload: proposal });

  const badMagic = valid.slice();
  badMagic[0] ^= 0xff;
  assert.throws(() => decodePayloadEnvelope(badMagic), /magic/);

  const badVersion = valid.slice();
  badVersion[4] = 2;
  assert.throws(() => decodePayloadEnvelope(badVersion), /version/);

  const badFlags = valid.slice();
  badFlags[5] = 0x80;
  assert.throws(() => decodePayloadEnvelope(badFlags), /flags/);

  const badReserved = valid.slice();
  badReserved[6] = 1;
  assert.throws(() => decodePayloadEnvelope(badReserved), /reserved/);

  const hiddenAmount = valid.slice();
  hiddenAmount[23] = 1;
  assert.throws(() => decodePayloadEnvelope(hiddenAmount), /zero amount/);

  assert.throws(() => decodePayloadEnvelope(valid.slice(0, -1)), /length mismatch/);
});

test("encoder rejects malformed nonce, oversized payload, and out-of-range amount", () => {
  assert.throws(
    () => encodePayloadEnvelope({ nonce: new Uint8Array(31), payload: proposal }),
    /nonce/,
  );
  assert.throws(
    () =>
      encodePayloadEnvelope({
        nonce,
        payload: new Uint8Array(MAX_APPLICATION_PAYLOAD_BYTES + 1),
      }),
    /at most/,
  );
  assert.throws(
    () => encodePayloadEnvelope({ amount: 1n << 127n, nonce, payload: proposal }),
    /i128 range/,
  );
});
