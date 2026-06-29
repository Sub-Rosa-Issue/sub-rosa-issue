// Receipt verification tests with golden and tampered fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReceipt, parseReceipt } from "@sub-rosa/sdk";
import { buildJsonOutput } from "./json-output.js";

const DIR = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  const path = resolve(DIR, "fixtures", name);
  return parseReceipt(readFileSync(path, "utf-8"));
}

test("golden fixture passes verification", () => {
  const receipt = loadFixture("golden.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true);
  assert.equal(result.computedWinner.address, receipt.winner);
  assert.equal(result.computedWinner.value?.toString(), receipt.winningValue);
});

test("tampered winner: wrong winner address fails", () => {
  const receipt = loadFixture("tampered-winner.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const winnerIssues = result.issues.filter((i) => i.code === "winner_mismatch");
  assert.equal(winnerIssues.length, 1);
  assert.match(winnerIssues[0].message, /computed winner is/);
});

test("tampered values: swapped values cause commitment mismatch", () => {
  const receipt = loadFixture("tampered-values.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  // GA4 committed commitment(100, aa) but receipt says revealedValue=250.
  // GB5 committed commitment(250, bb) but receipt says revealedValue=100.
  // Both fail the binding check.
  const cmtIssues = result.issues.filter((i) => i.code === "commitment_mismatch");
  assert.equal(cmtIssues.length, 2);
});

test("tampered commitment: tampered commitment hash fails binding check", () => {
  const receipt = loadFixture("tampered-commitment.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const cmtIssues = result.issues.filter((i) => i.code === "commitment_mismatch");
  assert.equal(cmtIssues.length, 1);
  assert.ok(cmtIssues[0].path?.includes("GA4GN"));
});

test("tampered network: wrong network passphrase fails via fingerprint mismatch", () => {
  // The fixture has a mainnet passphrase but a testnet networkFingerprint —
  // the verifier detects this without any caller-supplied context.
  const receipt = loadFixture("tampered-network.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "network_mismatch"));
});

test("invalid clearing rule fails", () => {
  const receipt = loadFixture("golden.json");
  (receipt as any).clearingRule = "InvalidRule";
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "invalid_clearing_rule"));
});

test("duplicate bidder fails", () => {
  const receipt = loadFixture("golden.json");
  receipt.bidders.push(receipt.bidders[0]);
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "duplicate_bidder"));
});

test("unsupported version fails", () => {
  const receipt = loadFixture("golden.json");
  (receipt as any).version = 99;
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "unsupported_version"));
});

test("tampered order: reordered bidders with tied values changes computed winner", () => {
  // Two bidders both revealed 300 (tied). For HighestBid with equal values,
  // the first in the bidders array wins. The fixture tampered the order so
  // that GB5HN appears before GA4GN, but the declared winner is still GA4GN
  // (the original first). This causes winner_mismatch.
  const receipt = loadFixture("tampered-order.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const orderIssues = result.issues.filter((i) => i.code === "winner_mismatch");
  assert.equal(orderIssues.length, 1);
  assert.match(orderIssues[0].message, /computed winner is/);
});

test("testnet proof fixture passes verification", () => {
  const receipt = loadFixture("testnet-proof.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, true);
  assert.equal(result.computedWinner.address, receipt.winner);
  assert.equal(result.computedWinner.value?.toString(), receipt.winningValue);
});

test("tampered evidence: invalid hex in ciphertext fails", () => {
  const receipt = loadFixture("tampered-evidence.json");
  const result = verifyReceipt(receipt);
  assert.equal(result.valid, false);
  const evidenceIssues = result.issues.filter((i) => i.code === "invalid_evidence_hex");
  assert.equal(evidenceIssues.length, 1);
  assert.ok(evidenceIssues[0].path?.includes("GA4GN"));
});

test("JSON mode: valid receipt produces stable output shape", () => {
  const receipt = loadFixture("golden.json");
  const result = verifyReceipt(receipt);
  const out = buildJsonOutput(receipt, result, null);
  assert.equal(out.valid, true);
  assert.equal(typeof out.receiptId, "string");
  assert.equal(out.receiptId!.length, 64);
  assert.equal(out.roundId, receipt.roundId);
  assert.equal(typeof out.checkedAt, "string");
  assert.ok(out.checkedAt.endsWith("Z"));
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.warnings, []);
});

test("JSON mode: invalid receipt includes error codes in errors array", () => {
  const receipt = loadFixture("tampered-winner.json");
  const result = verifyReceipt(receipt);
  const out = buildJsonOutput(receipt, result, null);
  assert.equal(out.valid, false);
  assert.equal(typeof out.receiptId, "string");
  assert.equal(out.roundId, receipt.roundId);
  assert.ok(out.errors.some((e) => e.code === "winner_mismatch"));
  assert.equal(out.warnings.length, 0);
});

test("JSON mode: malformed input produces parse_error with null ids", () => {
  const out = buildJsonOutput(null, null, "SyntaxError: Unexpected token < in JSON");
  assert.equal(out.valid, false);
  assert.equal(out.receiptId, null);
  assert.equal(out.roundId, null);
  assert.equal(typeof out.checkedAt, "string");
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].code, "parse_error");
  assert.ok(out.errors[0].message.includes("SyntaxError"));
  assert.deepEqual(out.warnings, []);
});
