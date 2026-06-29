import { test } from "node:test";
import assert from "node:assert/strict";

import { serializeReceipt, parseReceipt, type RoundReceipt } from "./receipt.js";
import { redactReceipt, type BidReceiptEntry } from "./redact.js";
import { verifyReceipt } from "./verify.js";

function makeReceipt(): RoundReceipt {
  return {
    version: 1,
    network: "Test SDF Network ; September 2015",
    networkFingerprint: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
    contractId: "CA3D5K7FJ3YZM2SJ6XJ6Y5Q5XJ6Z2M3SJ6XJ6Y5Q5XJ6Z2M3SJ6XJ6Y5",
    exportedAt: "2026-06-23T12:00:00.000Z",
    roundId: "1",
    itemRef: "ab84f41446646ddbea23656fda8f2e0c282deb2da09603618a71f9d2ff1d1d6d",
    revealRound: 5000000,
    clearingRule: "HighestBid",
    commitDeadline: "1728000",
    revealDeadline: "1731600",
    operator: "GBCDABQZOSZG4Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3",
    auditorPubkey: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    bidders: [
      "GA4GN2X7YQKQJF5Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3",
      "GB5HN3Y8ZRLRK6Z6Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4",
      "GC6IO4Z9ASMSL7A7Y5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5",
    ],
    bids: {
      "GA4GN2X7YQKQJF5Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3": {
        commitment: "d77d1adf5eca2aa1b1d26b310fe4da2af3900fb080bcb701cae8cae879be1e7a",
        escrow: "200",
        revealedValue: "100",
        nonce: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hashValid: true,
        valid: true,
        settled: true,
        evidence: {
          ciphertext: "a1b2c3d4",
          auditorBlob: "e5f6a7b8",
        },
      },
      "GB5HN3Y8ZRLRK6Z6Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4": {
        commitment: "c5ee5d77eaee11aac66da233c475bd9e14dc5dc89a639c84cfd8ca47d1837cb0",
        escrow: "500",
        revealedValue: "250",
        nonce: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        hashValid: true,
        valid: true,
        settled: false,
        evidence: {
          ciphertext: "b2c3d4e5",
          auditorBlob: "f6a7b8c9",
        },
      },
      "GC6IO4Z9ASMSL7A7Y5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5": {
        commitment: "ab84f41446646ddbea23656fda8f2e0c282deb2da09603618a71f9d2ff1d1d6d",
        escrow: "150",
        revealedValue: "75",
        nonce: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        hashValid: true,
        valid: true,
        settled: true,
        evidence: {
          ciphertext: "c3d4e5f6",
          auditorBlob: "07a8b9c0",
        },
      },
    },
    winner: "GB5HN3Y8ZRLRK6Z6Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4",
    winningValue: "250",
    status: "Settled",
  };
}

test("redacts top-level sensitive fields", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  assert.equal(redacted.contractId, "<redacted>");
  assert.equal(redacted.operator, "<redacted>");
  assert.equal(redacted.winner, "<redacted>");
  assert.equal(redacted.roundId, "<redacted>");
  assert.equal(redacted.itemRef, "<redacted>");
  assert.equal((redacted as any).revealRound, "<redacted>");
});

test("redacts bidder identities in bidders array", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  assert.deepEqual(redacted.bidders, ["<redacted:0>", "<redacted:1>", "<redacted:2>"]);
});

test("redacts bid keys in bids object with indexed placeholders", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  const bidKeys = Object.keys(redacted.bids);
  assert.deepEqual(bidKeys, ["<redacted:0>", "<redacted:1>", "<redacted:2>"]);
});

test("preserves non-sensitive proof metadata inside bids", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  const firstEntry = redacted.bids["<redacted:0>"] as BidReceiptEntry;
  assert.equal(firstEntry.commitment, receipt.bids[receipt.bidders[0]!].commitment);
  assert.equal(firstEntry.escrow, receipt.bids[receipt.bidders[0]!].escrow);
  assert.equal(firstEntry.revealedValue, receipt.bids[receipt.bidders[0]!].revealedValue);
  assert.equal(firstEntry.nonce, receipt.bids[receipt.bidders[0]!].nonce);
  assert.equal(firstEntry.hashValid, receipt.bids[receipt.bidders[0]!].hashValid);
  assert.equal(firstEntry.valid, receipt.bids[receipt.bidders[0]!].valid);
  assert.equal(firstEntry.settled, receipt.bids[receipt.bidders[0]!].settled);
});

test("redacts evidence ciphertext and auditorBlob", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  for (const entry of Object.values(redacted.bids) as BidReceiptEntry[]) {
    assert.equal(entry.evidence.ciphertext, "<redacted>");
    assert.equal(entry.evidence.auditorBlob, "<redacted>");
  }
});

test("preserves network and verification metadata", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt);

  assert.equal(redacted.network, receipt.network);
  assert.equal(redacted.networkFingerprint, receipt.networkFingerprint);
  assert.equal(redacted.version, receipt.version);
  assert.equal(redacted.clearingRule, receipt.clearingRule);
  assert.equal(redacted.status, receipt.status);
});

test("redaction output is deterministic", () => {
  const receipt = makeReceipt();
  const first = serializeReceipt(redactReceipt(receipt));
  const second = serializeReceipt(redactReceipt(receipt));
  assert.equal(first, second);
});

test("keep-list preserves specified top-level field", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt, { keep: ["contractId"] });

  assert.equal(redacted.contractId, receipt.contractId);
  assert.equal(redacted.operator, "<redacted>");
});

test("keep-list preserves specified nested field", () => {
  const receipt = makeReceipt();
  const originalBidder = receipt.bidders[0]!;
  const redacted = redactReceipt(receipt, {
    keep: [`bids.${originalBidder}.commitment`],
  });

  const entry = redacted.bids[originalBidder] as BidReceiptEntry;
  assert.equal(entry.commitment, receipt.bids[originalBidder]!.commitment);
  assert.equal(entry.evidence.ciphertext, "<redacted>");
});

test("keep-list preserves entire bid entry when path matches", () => {
  const receipt = makeReceipt();
  const originalBidder = receipt.bidders[0]!;
  const redacted = redactReceipt(receipt, {
    keep: [`bids.${originalBidder}`],
  });

  const entry = redacted.bids[originalBidder] as BidReceiptEntry;
  assert.equal(entry.commitment, receipt.bids[originalBidder]!.commitment);
  assert.equal(entry.evidence.ciphertext, receipt.bids[originalBidder]!.evidence.ciphertext);
  assert.equal(entry.evidence.auditorBlob, receipt.bids[originalBidder]!.evidence.auditorBlob);
});

test("already-redacted values are handled safely", () => {
  const receipt = makeReceipt();
  const once = redactReceipt(receipt);
  const twice = redactReceipt(once);

  assert.equal(once.contractId, "<redacted>");
  assert.equal(twice.contractId, "<redacted>");
  assert.deepEqual(Object.keys(twice.bids), Object.keys(once.bids));
});

test("handles null evidence gracefully", () => {
  const receipt = makeReceipt();
  const bidder = receipt.bidders[0]!;
  receipt.bids[bidder]!.evidence = { ciphertext: null, auditorBlob: null };
  const redacted = redactReceipt(receipt);

  const entry = redacted.bids["<redacted:0>"] as BidReceiptEntry;
  assert.equal(entry.evidence.ciphertext, null);
  assert.equal(entry.evidence.auditorBlob, null);
});

test("does not mutate the original receipt", () => {
  const receipt = makeReceipt();
  const originalJson = serializeReceipt(receipt);
  redactReceipt(receipt);
  assert.equal(serializeReceipt(receipt), originalJson);
});

test("unredacted copy does not affect original verification", () => {
  const receipt = makeReceipt();
  const copy = JSON.parse(JSON.stringify(receipt)) as RoundReceipt;
  redactReceipt(copy);
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("deep nested objects with multiple sensitive levels are redacted", () => {
  const receipt = makeReceipt() as any;
  receipt.auditTrail = {
    metadata: {
      internal: {
        accountId: "GXYZ...ABC",
        memo: "confidential note",
        details: {
          txHash: "abc123def456",
          appraiser: "GAPP...RAISER",
        },
      },
    },
  };
  const redacted = redactReceipt(receipt);
  assert.equal(redacted.auditTrail.metadata.internal.accountId, "<redacted>");
  assert.equal(redacted.auditTrail.metadata.internal.memo, "<redacted>");
  assert.equal(redacted.auditTrail.metadata.internal.details.txHash, "<redacted>");
  assert.equal(redacted.auditTrail.metadata.internal.details.appraiser, "<redacted>");
});

test("arrays inside nested objects are redacted correctly", () => {
  const receipt = makeReceipt() as any;
  receipt.reviewLog = {
    entries: [
      { bidder: "GA4GN2X7YQKQJF5Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3", note: "reviewed" },
      { bidder: "GB5HN3Y8ZRLRK6Z6Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4X4Y4", note: "reviewed" },
    ],
  };
  const redacted = redactReceipt(receipt);
  assert.deepEqual(redacted.reviewLog.entries, [
    { bidder: "<redacted>", note: "reviewed" },
    { bidder: "<redacted>", note: "reviewed" },
  ]);
});

test("keep-list preserves entire bidders array", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt, { keep: ["bidders"] });
  assert.deepEqual(redacted.bidders, receipt.bidders);
});

test("keep-list preserves entire bids object", () => {
  const receipt = makeReceipt();
  const redacted = redactReceipt(receipt, { keep: ["bids"] });
  assert.deepEqual(Object.keys(redacted.bids), Object.keys(receipt.bids));
  for (const bidder of receipt.bidders) {
    const entry = redacted.bids[bidder] as BidReceiptEntry;
    assert.equal(entry.commitment, receipt.bids[bidder]!.commitment);
    assert.equal(entry.evidence.ciphertext, receipt.bids[bidder]!.evidence.ciphertext);
    assert.equal(entry.evidence.auditorBlob, receipt.bids[bidder]!.evidence.auditorBlob);
  }
});

test("idempotent on nested structures", () => {
  const receipt = makeReceipt() as any;
  receipt.auditTrail = {
    internal: {
      accountId: "GXYZ...ABC",
      details: {
        txHash: "abc123",
      },
    },
  };
  const once = redactReceipt(receipt);
  const twice = redactReceipt(once);
  assert.equal(serializeReceipt(once), serializeReceipt(twice));
});
