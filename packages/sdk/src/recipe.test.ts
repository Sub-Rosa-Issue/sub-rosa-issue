// recipe.test.ts — validates the encoding path exercised by docs/RECIPES.md.
//
// Runs entirely offline: no RPC, no Drand network calls. It mirrors the
// exact sequence a caller uses in the recipe (createRound args → commit args)
// and asserts that every field encodes to the expected wire bytes via the
// contract Spec.

import { test } from "node:test";
import assert from "node:assert/strict";

import { StrKey, scValToNative } from "@stellar/stellar-sdk";
import { commitment, generateNonce } from "@sub-rosa/tlock";
import { SubRosaClient } from "./index.js";

const TESTNET = "Test SDF Network ; September 2015";

function newClient(): SubRosaClient {
  return new SubRosaClient({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET,
    contractId: StrKey.encodeContract(Buffer.alloc(32)),
  });
}

const addr = (fill: number) =>
  StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));

// ── Recipe step 3: createRound ──────────────────────────────────────────

test("recipe createRound args encode correctly", () => {
  const c = newClient();
  const operator = addr(1);
  const itemRef = new Uint8Array(32).fill(0xab);
  const auditorPubkey = new Uint8Array(96).fill(0xcd);
  const revealRound = 29_000_000n;
  const commitDeadline = 1_000_000n;
  const revealDeadline = 2_000_000n;

  const args = c.spec.funcArgsToScVals("create_round", {
    operator,
    item_ref: Buffer.from(itemRef),
    reveal_round: revealRound,
    clearing_rule: { tag: "HighestBid", values: undefined },
    commit_deadline: commitDeadline,
    reveal_deadline: revealDeadline,
    auditor_pubkey: Buffer.from(auditorPubkey),
  });

  assert.equal(args.length, 7);
  assert.equal(scValToNative(args[0]), operator);
  assert.deepEqual(new Uint8Array(scValToNative(args[1])), itemRef);
  assert.equal(scValToNative(args[2]), revealRound);
  assert.deepEqual(scValToNative(args[3]), ["HighestBid"]);
  assert.equal(scValToNative(args[4]), commitDeadline);
  assert.equal(scValToNative(args[5]), revealDeadline);
  assert.deepEqual(new Uint8Array(scValToNative(args[6])), auditorPubkey);
});

// ── Recipe step 4: sealBid → commit ────────────────────────────────────

test("recipe commit args encode a real commitment + nonce correctly", () => {
  const c = newClient();
  const bidder = addr(2);
  const value = 700n;
  const nonce = generateNonce();
  const h = commitment(value, nonce);

  // Simulate what sealBid returns (commitment + placeholder ciphertext + auditorBlob)
  const ciphertext = new TextEncoder().encode("age-encryption.org/v1-placeholder");
  const auditorBlob = new Uint8Array(48).fill(0xef);

  const args = c.spec.funcArgsToScVals("commit", {
    round_id: 1n,
    bidder,
    commitment: Buffer.from(h),
    ciphertext: Buffer.from(ciphertext),
    escrow: value,
    auditor_blob: Buffer.from(auditorBlob),
  });

  assert.equal(args.length, 6);
  assert.equal(scValToNative(args[0]), 1n);
  assert.equal(scValToNative(args[1]), bidder);
  assert.deepEqual(new Uint8Array(scValToNative(args[2])), h);
  assert.equal(scValToNative(args[3]).length, ciphertext.length);
  assert.equal(scValToNative(args[4]), value);
  assert.deepEqual(new Uint8Array(scValToNative(args[5])), auditorBlob);
});

// ── commitment property: deterministic, 32 bytes, value-sensitive ───────

test("recipe nonce and commitment contract invariants", () => {
  const nonce = generateNonce();
  assert.equal(nonce.length, 32);

  const h1 = commitment(100n, nonce);
  const h2 = commitment(101n, nonce);
  assert.equal(h1.length, 32);
  assert.notDeepEqual(h1, h2, "different values must yield different commitments");

  // Same inputs → same hash (deterministic)
  assert.deepEqual(commitment(100n, nonce), h1);
});

// ── LowestBid variant works for RFP / grant-scoring use case ───────────

test("recipe LowestBid clearing rule encodes correctly", () => {
  const c = newClient();
  const args = c.spec.funcArgsToScVals("create_round", {
    operator: addr(1),
    item_ref: Buffer.from(new Uint8Array(32)),
    reveal_round: 1n,
    clearing_rule: { tag: "LowestBid", values: undefined },
    commit_deadline: 1n,
    reveal_deadline: 2n,
    auditor_pubkey: Buffer.from(new Uint8Array(96)),
  });
  assert.deepEqual(scValToNative(args[3]), ["LowestBid"]);
});
