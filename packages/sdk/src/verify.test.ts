// Offline receipt verifier — schema version rejection tests.
//
// The verifier must produce a clean, deterministic failure for any receipt
// whose version field is not 1. An early return guarantees no downstream
// bid-level checks run, so computedWinner is always null on rejection.

import { test } from "node:test";
import assert from "node:assert/strict";

import { StrKey } from "@stellar/stellar-sdk";
import { commitment } from "@sub-rosa/tlock";
import { verifyReceipt } from "./verify.js";
import { networkFingerprint, type RoundReceipt } from "./receipt.js";

const TESTNET = "Test SDF Network ; September 2015";
const TESTNET_FP = networkFingerprint(TESTNET);

function makeValidV1Receipt(): RoundReceipt {
  const bidder = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x01));
  const value = 100n;
  const nonce = new Uint8Array(32).fill(0xaa);
  const comm = Buffer.from(commitment(value, nonce)).toString("hex");

  return {
    version: 1,
    network: TESTNET,
    networkFingerprint: TESTNET_FP,
    contractId: StrKey.encodeContract(Buffer.alloc(32)),
    exportedAt: "2026-06-30T00:00:00.000Z",
    roundId: "1",
    itemRef: "ab84f41446646ddbea23656fda8f2e0c282deb2da09603618a71f9d2ff1d1d6d",
    revealRound: 5000000,
    clearingRule: "HighestBid",
    commitDeadline: "1728000",
    revealDeadline: "1731600",
    operator: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x02)),
    auditorPubkey: "deadbeef".repeat(24),
    bidders: [bidder],
    bids: {
      [bidder]: {
        commitment: comm,
        escrow: "1000",
        revealedValue: value.toString(),
        nonce: Buffer.from(nonce).toString("hex"),
        hashValid: true,
        valid: true,
        settled: true,
        evidence: { ciphertext: null, auditorBlob: null },
      },
    },
    winner: bidder,
    winningValue: value.toString(),
    status: "Settled",
  };
}

test("version 0: unsupported version produces error and invalid result", () => {
  const receipt = { ...makeValidV1Receipt(), version: 0 } as any;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const versionIssues = result.issues.filter((i) => i.code === "unsupported_version");
  assert.equal(versionIssues.length, 1);
  assert.equal(versionIssues[0].severity, "error");
  assert.match(versionIssues[0].message, /version 0 is not supported/);
});

test("version 2: future schema version is rejected", () => {
  const receipt = { ...makeValidV1Receipt(), version: 2 } as any;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const versionIssues = result.issues.filter((i) => i.code === "unsupported_version");
  assert.equal(versionIssues.length, 1);
  assert.equal(versionIssues[0].severity, "error");
  assert.match(versionIssues[0].message, /version 2 is not supported/);
});

test("version 99: arbitrary high version is rejected", () => {
  const receipt = { ...makeValidV1Receipt(), version: 99 } as any;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const versionIssues = result.issues.filter((i) => i.code === "unsupported_version");
  assert.equal(versionIssues.length, 1);
  assert.match(versionIssues[0].message, /version 99 is not supported/);
});

test("version rejection: computedWinner is null on unsupported version", () => {
  const receipt = { ...makeValidV1Receipt(), version: 5 } as any;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.equal(result.computedWinner.address, null);
  assert.equal(result.computedWinner.value, null);
});

test("version rejection: no bid-level issues emitted (early return isolation)", () => {
  const receipt = { ...makeValidV1Receipt(), version: 2 } as any;
  // Corrupt a bid commitment so it would fail if reached.
  const bidder = receipt.bidders[0];
  receipt.bids[bidder].commitment = "0".repeat(64);
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  // Only the version issue; no commitment_mismatch or any other code.
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "unsupported_version");
});

test("version 1: valid receipt passes without unsupported_version issue", () => {
  const receipt = makeValidV1Receipt();
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true);
  const versionIssues = result.issues.filter((i) => i.code === "unsupported_version");
  assert.equal(versionIssues.length, 0);
  assert.equal(result.computedWinner.address, receipt.winner);
  assert.equal(result.computedWinner.value?.toString(), receipt.winningValue);
});
