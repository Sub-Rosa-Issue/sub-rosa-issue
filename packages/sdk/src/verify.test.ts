// Copyright (c) 2026 Sub Rosa contributors
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
import { verifyReceiptEvents } from "./receipt-events.js";
import { expectedRoundEventSequence, ROUND_EVENT_PHASE_BY_NAME } from "@sub-rosa/round-bindings/event-snapshot";
import { networkFingerprint, type RoundReceipt, type RoundReceiptEvent } from "./receipt.js";

const TESTNET = "Test SDF Network ; September 2015";
const TESTNET_FP = networkFingerprint(TESTNET);

/** Ordered lifecycle event log for a healthy settled round. */
export function makeValidEventLog(roundId: string): RoundReceiptEvent[] {
  return expectedRoundEventSequence(BigInt(roundId)).map(({ name }, i) => ({
    name,
    topics: ["symbol_short", "u64"] as const,
    roundId,
    ledger: 100 + i,
    phase: ROUND_EVENT_PHASE_BY_NAME[name],
  }));
}

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
    events: makeValidEventLog("1"),
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

// ── Ordered on-chain event verification (issue #379) ────────────────────

test("receipt with the full ordered lifecycle event log verifies", () => {
  const receipt = makeValidV1Receipt();
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("receipt missing the settle event fails verification", () => {
  const receipt = makeValidV1Receipt();
  receipt.events = receipt.events.filter((e) => e.name !== "settled");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const missing = result.issues.filter((i) => i.code === "missing_events_required");
  assert.equal(missing.length, 1);
  assert.match(missing[0]!.message, /"settled"/);
});

test("reordered events fail verification", () => {
  const receipt = makeValidV1Receipt();
  // Swap cleared before commit — a sequence the ledger could not produce.
  const commitIdx = receipt.events.findIndex((e) => e.name === "commit");
  const clearedIdx = receipt.events.findIndex((e) => e.name === "cleared");
  const tmp = receipt.events[commitIdx]!;
  receipt.events[commitIdx] = receipt.events[clearedIdx]!;
  receipt.events[clearedIdx] = tmp;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "event_not_in_ledger_order"));
});

test("duplicate settle events fail verification", () => {
  const receipt = makeValidV1Receipt();
  receipt.events.push({
    ...receipt.events.find((e) => e.name === "settled")!,
    ledger: 9999,
  });
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const dup = result.issues.filter((i) => i.code === "duplicate_settle_event");
  assert.equal(dup.length, 1);
  assert.match(dup[0]!.message, /settles at most once/);
});

test("a receipt from another contract fails verification when expectedContractId is given", () => {
  const receipt = makeValidV1Receipt();
  const expected = StrKey.encodeContract(Buffer.alloc(32, 0x07));
  const result = verifyReceipt(receipt, { expectedContractId: expected });
  assert.equal(result.valid, false);
  const mismatch = result.issues.filter((i) => i.code === "event_contract_mismatch");
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0]!.message, /expected/);
});

test("a receipt from another network fails verification when expectedNetworkPassphrase is given", () => {
  const receipt = makeValidV1Receipt();
  receipt.network = "Other Network ; January 2030";
  receipt.networkFingerprint = networkFingerprint(receipt.network);
  const result = verifyReceipt(receipt, {
    expectedNetworkPassphrase: TESTNET,
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "event_network_mismatch"));
});

test("consistent self-contained network tampering is caught by expectedNetworkPassphrase", () => {
  // The fingerprint-only check cannot see a receipt whose network and
  // networkFingerprint were rewritten together. The caller-supplied expected
  // passphrase closes that gap.
  const receipt = makeValidV1Receipt();
  receipt.network = "Other Network ; January 2030";
  receipt.networkFingerprint = networkFingerprint(receipt.network);
  const withoutPin = verifyReceipt(receipt);
  assert.equal(withoutPin.valid, true, "fingerprint alone must stay consistent");
  const withPin = verifyReceipt(receipt, {
    expectedNetworkPassphrase: TESTNET,
  });
  assert.equal(withPin.valid, false);
});

test("event referencing a different round id fails verification", () => {
  const receipt = makeValidV1Receipt();
  receipt.events[3]!.roundId = "2";
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "event_round_id_mismatch"));
});

test("scrambled topic tuple fails verification", () => {
  const receipt = makeValidV1Receipt();
  (receipt.events[0] as any).topics = ["u64", "symbol_short"];
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "invalid_event_topics"));
});

test("event phase inconsistent with its name fails verification", () => {
  const receipt = makeValidV1Receipt();
  (receipt.events.find((e) => e.name === "settled") as any).phase = "round-created";
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "event_phase_mismatch"));
});

test("unknown event name fails verification", () => {
  const receipt = makeValidV1Receipt();
  (receipt.events[0] as any).name = "liquidated";
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "unknown_event_name"));
});

test("receipt with no event log at all fails verification", () => {
  const receipt = makeValidV1Receipt();
  (receipt as any).events = undefined;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "missing_events"));
});

test("verifyReceiptEvents: exported helper agrees with verifyReceipt on the missing-settle case", () => {
  const receipt = makeValidV1Receipt();
  receipt.events = receipt.events.filter((e) => e.name !== "settled");
  const direct = verifyReceiptEvents(receipt);
  assert.equal(direct.valid, false);
  assert.ok(direct.issues.some((i) => i.code === "missing_events_required"));
});

test("version rejection still short-circuits before event checks", () => {
  const receipt = { ...makeValidV1Receipt(), version: 2 } as any;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "unsupported_version");
});
