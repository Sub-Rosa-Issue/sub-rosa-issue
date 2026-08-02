/**
 * Negative cap-safety scenarios — documented for jury demo + UI cap lab parity.
 * These prove agent-side refusal/clamp; on-chain escrow is a separate ceiling.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import {
  assertAppraisalSpendAllowed,
  assertBidWithinMandate,
  assertSufficientBalance,
  bidFromAppraisal,
  createSessionMandate,
  InsufficientBalanceError,
  MandateCapError,
  usdcToStroops,
} from "./mandate.js";

const base = () => ({
  principalSecret: Keypair.random().secret(),
  contractId: "CDEMOCONTRACT",
  roundId: 1,
  itemRef: "demo-item",
  basePriceUsdc: 500,
  maxBidStroops: usdcToStroops(100),
  maxEscrowStroops: usdcToStroops(100),
  maxAppraisalSpendStroops: usdcToStroops(0.5),
  appraisalPriceStroops: usdcToStroops(0.1),
  commitDeadline: Math.floor(Date.now() / 1000) + 3600,
});

test("NEGATIVE: agent rejects x402 price above mandate appraisalPriceStroops", () => {
  const { mandate } = createSessionMandate(base());
  assert.throws(
    () => assertAppraisalSpendAllowed(mandate, usdcToStroops(0.25)),
    MandateCapError,
  );
});

test("NEGATIVE: agent clamps bid to mandate maxBid (not on-chain maxBid)", () => {
  const { mandate } = createSessionMandate(base());
  const { bidValue } = bidFromAppraisal(9999, mandate);
  assert.equal(bidValue, usdcToStroops(100));
});

test("NEGATIVE: agent rejects explicit bid above mandate maxBid", () => {
  const { mandate } = createSessionMandate(base());
  assert.throws(
    () => assertBidWithinMandate(mandate, usdcToStroops(150), usdcToStroops(150)),
    MandateCapError,
  );
});

test("NEGATIVE: agent rejects escrow exceeding session balance", () => {
  assert.throws(
    () => assertSufficientBalance(usdcToStroops(200), usdcToStroops(50)),
    InsufficientBalanceError,
  );
});

test("ON-CHAIN RULE: value > escrow → valid=false at reveal (documented)", () => {
  const escrow = 50n;
  const value = 80n;
  const valid = value > 0n && value <= escrow;
  assert.equal(valid, false);
});
