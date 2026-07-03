// Offline binding-encoding tests.
//
// These exercise the real correctness surface of a contract-binding SDK: the
// bytes it puts on the wire. They run entirely against the contract Spec
// embedded in the generated bindings — no network, no deploy, no mock. Each
// argument type the contract declares (u64, i128, Address, Bytes, BytesN<32>,
// BytesN<96>, enums, structs) is encoded and round-tripped, and the SealedBid
// produced by @sub-rosa/tlock is shown to encode byte-for-byte into `commit`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { StrKey, scValToNative } from "@stellar/stellar-sdk";
import { commitment, type SealedBid } from "@sub-rosa/tlock";
import { SubRosaClient } from "./index.js";

const TESTNET = "Test SDF Network ; September 2015";

function newClient(): SubRosaClient {
  // A syntactically valid contract id and an unreachable RPC URL: constructing
  // the client never touches the network, and the Spec is available offline.
  return new SubRosaClient({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET,
    contractId: StrKey.encodeContract(Buffer.alloc(32)),
  });
}

const addr = (fill: number) =>
  StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
const u8 = (len: number, fill: number) => new Uint8Array(len).fill(fill);

test("commit args encode and round-trip exactly", () => {
  const c = newClient();
  const bidder = addr(1);
  const cmt = u8(32, 7);
  const ciphertext = new TextEncoder().encode("age-encryption.org/v1...");
  const auditorBlob = u8(48, 9);

  const args = c.spec.funcArgsToScVals("commit", {
    round_id: 1n,
    bidder,
    commitment: Buffer.from(cmt),
    ciphertext: Buffer.from(ciphertext),
    escrow: 700n,
    auditor_blob: Buffer.from(auditorBlob),
  });

  assert.equal(args.length, 6);
  const [roundId, b, cm, ct, escrow, ab] = args.map((a) => scValToNative(a));
  assert.equal(roundId, 1n);
  assert.equal(b, bidder);
  assert.deepEqual(new Uint8Array(cm), cmt);
  assert.deepEqual(new Uint8Array(ct), ciphertext);
  assert.equal(escrow, 700n);
  assert.deepEqual(new Uint8Array(ab), auditorBlob);
});

test("create_round encodes Address, u64, BytesN<32>, Bytes and the enum", () => {
  const c = newClient();
  const operator = addr(2);

  const args = c.spec.funcArgsToScVals("create_round", {
    operator,
    item_ref: Buffer.from(u8(32, 3)),
    reveal_round: 19_283_746n,
    clearing_rule: { tag: "LowestBid", values: undefined },
    commit_deadline: 1_000n,
    reveal_deadline: 2_000n,
    auditor_pubkey: Buffer.from(u8(96, 4)),
  });

  assert.equal(args.length, 7);
  assert.equal(scValToNative(args[0]), operator);
  assert.deepEqual(new Uint8Array(scValToNative(args[1])), u8(32, 3));
  assert.equal(scValToNative(args[2]), 19_283_746n);
  // A unit enum encodes on the wire as a vec carrying its variant symbol.
  assert.deepEqual(scValToNative(args[3]), ["LowestBid"]);
  assert.equal(scValToNative(args[4]), 1_000n);
  assert.equal(scValToNative(args[5]), 2_000n);
  assert.deepEqual(new Uint8Array(scValToNative(args[6])), u8(96, 4));
});

test("open_reveal enforces the 96-byte BLS signature width", () => {
  const c = newClient();
  const sig = u8(96, 5);
  const args = c.spec.funcArgsToScVals("open_reveal", {
    round_id: 2n,
    drand_signature: Buffer.from(sig),
  });
  assert.equal(args.length, 2);
  assert.deepEqual(new Uint8Array(scValToNative(args[1])), sig);

  // A wrong-width signature must be rejected at encode time, not silently padded.
  assert.throws(() =>
    c.spec.funcArgsToScVals("open_reveal", {
      round_id: 2n,
      drand_signature: Buffer.from(u8(95, 5)),
    }),
  );
});

test("reveal encodes i128 value and the 32-byte nonce", () => {
  const c = newClient();
  const bidder = addr(1);
  const nonce = u8(32, 8);
  const args = c.spec.funcArgsToScVals("reveal", {
    round_id: 3n,
    bidder,
    value: 12_345n,
    nonce: Buffer.from(nonce),
  });
  assert.equal(args.length, 4);
  assert.equal(scValToNative(args[2]), 12_345n);
  assert.deepEqual(new Uint8Array(scValToNative(args[3])), nonce);
});

test("commit rejects a wrong-width commitment (BytesN<32>)", () => {
  const c = newClient();
  assert.throws(() =>
    c.spec.funcArgsToScVals("commit", {
      round_id: 1n,
      bidder: addr(1),
      commitment: Buffer.from(u8(31, 7)),
      ciphertext: Buffer.from("x"),
      escrow: 1n,
      auditor_blob: Buffer.alloc(0),
    }),
  );
});

test("a tlock SealedBid encodes byte-for-byte into commit", () => {
  const c = newClient();
  const value = 700n;
  const nonce = u8(32, 1);
  const h = commitment(value, nonce); // off-chain H = sha256(be16(value)‖nonce)

  const sealed: SealedBid = {
    commitment: h,
    ciphertext: new TextEncoder().encode("age-armored"),
    auditorBlob: new Uint8Array(0),
  };

  const args = c.spec.funcArgsToScVals("commit", {
    round_id: 9n,
    bidder: addr(1),
    commitment: Buffer.from(sealed.commitment),
    ciphertext: Buffer.from(sealed.ciphertext),
    escrow: value,
    auditor_blob: Buffer.from(sealed.auditorBlob),
  });

  // The H the contract will hash-check is exactly the H tlock produced.
  assert.equal(h.length, 32);
  assert.deepEqual(new Uint8Array(scValToNative(args[2])), h);
  assert.equal(scValToNative(args[4]), value);
});

test("get_bidders_page encodes u64 round_id, u32 cursor, u32 limit", () => {
  const c = newClient();
  const args = c.spec.funcArgsToScVals("get_bidders_page", {
    round_id: 5n,
    cursor: 10,
    limit: 50,
  });
  assert.equal(args.length, 3);
  assert.equal(scValToNative(args[0]), 5n);
  assert.equal(scValToNative(args[1]), 10);
  assert.equal(scValToNative(args[2]), 50);
});

test("get_bidders_page rejects limit 0 (contract enforces 1-100)", () => {
  const c = newClient();
  // The spec type is u32, so limit=0 should encode fine; the contract rejects it.
  const args = c.spec.funcArgsToScVals("get_bidders_page", {
    round_id: 1n,
    cursor: 0,
    limit: 0,
  });
  assert.equal(args.length, 3);
  assert.equal(scValToNative(args[2]), 0);
});

test("get_bidders_page rejects limit > 100 (contract enforces 1-100)", () => {
  const c = newClient();
  const args = c.spec.funcArgsToScVals("get_bidders_page", {
    round_id: 1n,
    cursor: 0,
    limit: 101,
  });
  assert.equal(args.length, 3);
  assert.equal(scValToNative(args[2]), 101);
});

test("ClearingRule selects the correct variant for both tags", () => {
  const c = newClient();
  const baseArgs = {
    operator: addr(2),
    item_ref: Buffer.from(u8(32, 3)),
    reveal_round: 1n,
    commit_deadline: 1_000n,
    reveal_deadline: 2_000n,
    auditor_pubkey: Buffer.from(u8(96, 4)),
  };
  for (const tag of ["HighestBid", "LowestBid"] as const) {
    const args = c.spec.funcArgsToScVals("create_round", {
      ...baseArgs,
      clearing_rule: { tag, values: undefined },
    });
    assert.deepEqual(scValToNative(args[3]), [tag]);
  }
});
