import { test } from "node:test";
import assert from "node:assert/strict";

import {
  beBytesToI128,
  commitment,
  decodeBidPreimage,
  encodeBidPreimage,
  fromHex,
  i128ToBeBytes,
  toHex,
} from "./commitment.js";

// Frozen vector shared with the Round contract's Rust test
// (`commitment_matches_offchain_vector`). This is the single source of truth
// that off-chain H == on-chain sha256(value ‖ nonce) over identical bytes.
const FROZEN_VALUE = 700n;
const FROZEN_NONCE = new Uint8Array(32).fill(0x11);
const FROZEN_PREIMAGE =
  "000000000000000000000000000002bc" + "11".repeat(32);
const FROZEN_H =
  "3d4c2d3604b23250687f0344a9474e3c748742a4fba4616d308d529121a8dec4";

test("frozen commitment vector matches the contract (cross-language parity)", () => {
  assert.equal(toHex(encodeBidPreimage(FROZEN_VALUE, FROZEN_NONCE)), FROZEN_PREIMAGE);
  assert.equal(toHex(commitment(FROZEN_VALUE, FROZEN_NONCE)), FROZEN_H);
});

test("preimage encode/decode roundtrip", () => {
  const pre = encodeBidPreimage(FROZEN_VALUE, FROZEN_NONCE);
  const { value, nonce } = decodeBidPreimage(pre);
  assert.equal(value, FROZEN_VALUE);
  assert.deepEqual([...nonce], [...FROZEN_NONCE]);
});

test("i128 big-endian encode/decode incl. large values", () => {
  for (const v of [0n, 1n, 700n, 1_000_000n, (1n << 126n)]) {
    assert.equal(beBytesToI128(i128ToBeBytes(v)), v);
  }
});

test("wrong nonce or value yields a different commitment", () => {
  const h = toHex(commitment(FROZEN_VALUE, FROZEN_NONCE));
  const hWrongNonce = toHex(commitment(FROZEN_VALUE, new Uint8Array(32).fill(0x99)));
  const hWrongValue = toHex(commitment(701n, FROZEN_NONCE));
  assert.notEqual(h, hWrongNonce);
  assert.notEqual(h, hWrongValue);
});

test("rejects out-of-range and malformed inputs", () => {
  assert.throws(() => i128ToBeBytes(1n << 127n)); // > i128 max
  assert.throws(() => encodeBidPreimage(1n, new Uint8Array(31)));
  assert.throws(() => decodeBidPreimage(new Uint8Array(47)));
});

test("fromHex decodes lowercase, uppercase, and prefixed values", () => {
  const expected = [0xab, 0xcd, 0xef];
  assert.deepEqual([...fromHex("abcdef")], expected);
  assert.deepEqual([...fromHex("ABCDEF")], expected);
  assert.deepEqual([...fromHex("0xAbCdEf")], expected);
  assert.deepEqual([...fromHex("0XABCDEF")], expected);
});

test("fromHex accepts empty input as an empty byte array", () => {
  assert.deepEqual([...fromHex("")], []);
  assert.deepEqual([...fromHex("0x")], []);
});

test("fromHex rejects odd-length and non-hex input", () => {
  assert.throws(() => fromHex("abc"), /odd hex length/);
  assert.throws(() => fromHex("zz"), /invalid hex characters/);
  assert.throws(() => fromHex("12 3"), /invalid hex characters/);
  assert.throws(() => fromHex("0x12gg"), /invalid hex characters/);
});
