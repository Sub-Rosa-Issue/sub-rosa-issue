// exportReceipt integration test — no network, no deploy.
//
// Verifies that the receipt produced by SubRosaClient.exportReceipt() includes
// the on-chain nonce (revealed_nonce) so the offline verifier can recompute
// sha256(be16(value) || nonce) and confirm the commitment binding.

import { test } from "node:test";
import assert from "node:assert/strict";

import { StrKey } from "@stellar/stellar-sdk";
import { commitment } from "@sub-rosa/tlock";
import { SubRosaClient } from "./client.js";
import { verifyReceipt } from "./verify.js";

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

function fakeResult<T>(value: T) {
  return { result: { unwrap: () => value } } as any;
}

test("exportReceipt includes revealed_nonce — offline verifier recomputes commitment binding", async () => {
  const client = newClient();

  const bidder = addr(1);
  const value = 500n;
  const nonce = new Uint8Array(32).fill(0xab);
  const comm = commitment(value, nonce); // sha256(be16(500) || nonce)
  const nonceBuffer = Buffer.from(nonce);

  const fakeRound = {
    item_ref: Buffer.alloc(32, 0x01),
    reveal_round: 12345n,
    clearing_rule: { tag: "HighestBid" },
    commit_deadline: 1000n,
    reveal_deadline: 2000n,
    operator: addr(2),
    auditor_pubkey: Buffer.alloc(96, 0x03),
    status: { tag: "Settled" },
    winner: bidder,
    winning_bid: value,
  };

  const fakeBidState = {
    commitment: Buffer.from(comm),
    escrow: 1000n,
    revealed_value: value,
    revealed_nonce: nonceBuffer,
    valid: true,
    settled: true,
  };

  // Stub the contract methods exportReceipt calls.
  (client.contract as any).get_round = async () => fakeResult(fakeRound);
  (client.contract as any).get_config = async () =>
    fakeResult({ usdc: addr(3), drand_pubkey: Buffer.alloc(192), g2_neg_generator: Buffer.alloc(192), dst: Buffer.alloc(0), drand_genesis: 0n, drand_period: 3n });
  (client.contract as any).get_bidders_page = async (_args: any) =>
    fakeResult({ data: [bidder], next_cursor: 0, total: 1 });
  (client.contract as any).get_bid_state = async () => fakeResult(fakeBidState);
  (client.contract as any).get_seal = async () => ({ result: undefined });

  const receipt = await client.exportReceipt(1n);

  // The nonce must be present in the exported receipt.
  const entry = receipt.bids[bidder];
  assert.ok(entry, "bid entry should exist");
  assert.equal(entry.nonce, Buffer.from(nonce).toString("hex"),
    "exported nonce must match the on-chain revealed_nonce");
  assert.equal(entry.revealedValue, value.toString());

  // The offline verifier must be able to recompute and confirm the binding.
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true, `verifyReceipt failed: ${JSON.stringify(result.issues)}`);
  assert.equal(result.computedWinner.address, bidder);
  assert.equal(result.computedWinner.value, value);

  // Confirm the commitment_mismatch path is actually exercised by tampering.
  const tampered = structuredClone(receipt);
  tampered.bids[bidder].revealedValue = "999";
  const tamperedResult = verifyReceipt(tampered);
  assert.equal(tamperedResult.valid, false);
  assert.ok(tamperedResult.issues.some((i) => i.code === "commitment_mismatch"),
    "tampered receipt should fail commitment binding");
});
