import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeTime } from "@sub-rosa/time";

import { Keypair } from "@stellar/stellar-sdk";

import {
  assertAppraisalSpendAllowed,
  assertBidWithinMandate,
  bidFromAppraisal,
  createSessionMandate,
  MandateCapError,
  MandateError,
  mandateDigest,
  usdcToStroops,
  verifySessionMandate,
} from "./mandate.js";

const baseParams = () => {
  const principal = Keypair.random();
  const session = Keypair.random();
  const { clock } = createFakeTime(1_700_000_000_000);
  return {
    principalSecret: principal.secret(),
    principalPub: principal.publicKey(),
    sessionSecret: session.secret(),
    contractId: "CCONTRACT123456789012345678901234567890123456789012345678901234",
    roundId: 1n,
    itemRef: "sub-rosa://demo/item",
    basePriceUsdc: 500,
    category: "spectrum" as const,
    maxBidStroops: usdcToStroops(100),
    maxEscrowStroops: usdcToStroops(120),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: clock.nowSeconds() + 3600,
    clock,
  };
};

test("createSessionMandate + verifySessionMandate round-trip", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  verifySessionMandate(mandate, {
    contractId: p.contractId,
    roundId: p.roundId,
    clock: p.clock,
  });
  assert.equal(mandate.principal, p.principalPub);
});

test("tampered mandate fails verification", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  mandate.maxBidStroops = String(usdcToStroops(999));
  assert.throws(() => verifySessionMandate(mandate, { clock: p.clock }), MandateError);
});

test("assertBidWithinMandate enforces maxBid and bid<=escrow", () => {
  const { mandate } = createSessionMandate(baseParams());
  assert.throws(
    () => assertBidWithinMandate(mandate, usdcToStroops(150), usdcToStroops(150)),
    MandateCapError,
  );
  assert.throws(
    () => assertBidWithinMandate(mandate, usdcToStroops(50), usdcToStroops(40)),
    MandateCapError,
  );
  assert.doesNotThrow(() =>
    assertBidWithinMandate(mandate, usdcToStroops(50), usdcToStroops(50)),
  );
});

test("assertAppraisalSpendAllowed caps per-call and cumulative spend", () => {
  const { mandate } = createSessionMandate(baseParams());
  assert.throws(
    () => assertAppraisalSpendAllowed(mandate, usdcToStroops(0.2)),
    MandateCapError,
  );
  assert.throws(
    () => assertAppraisalSpendAllowed(mandate, usdcToStroops(0.1), usdcToStroops(0.95)),
    MandateCapError,
  );
});

test("bidFromAppraisal clamps to mandate maxBid", () => {
  const p = baseParams();
  p.maxBidStroops = usdcToStroops(40);
  p.maxEscrowStroops = usdcToStroops(50);
  const { mandate } = createSessionMandate(p);
  const { bidValue, escrow } = bidFromAppraisal(999, mandate);
  assert.equal(bidValue, usdcToStroops(40));
  assert.equal(escrow, usdcToStroops(40));
});

test("createSessionMandate rejects unsafe numeric fields", () => {
  const p = baseParams();
  assert.throws(
    () => createSessionMandate({ ...p, basePriceUsdc: Number.NaN }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate basePriceUsdc",
  );
  assert.throws(
    () => createSessionMandate({ ...p, commitDeadline: p.commitDeadline + 0.5 }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate commitDeadline",
  );
  assert.throws(
    () => createSessionMandate({ ...p, roundId: 1.5 }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate roundId",
  );
});

test("verifySessionMandate rejects a signed mandate with unsafe fields", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _signature, ...payload } = mandate;
  const malformed = {
    ...payload,
    basePriceUsdc: Number.MAX_SAFE_INTEGER + 1,
    signature: Keypair.fromSecret(p.principalSecret)
      .sign(mandateDigest({ ...payload, basePriceUsdc: Number.MAX_SAFE_INTEGER + 1 }))
      .toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(malformed, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate basePriceUsdc",
  );
});

test("verifySessionMandate rejects malformed stroop strings", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _signature, ...payload } = mandate;
  const malformedPayload = { ...payload, maxBidStroops: "1.5" };
  const malformed = {
    ...malformedPayload,
    signature: Keypair.fromSecret(p.principalSecret)
      .sign(mandateDigest(malformedPayload))
      .toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(malformed, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate maxBidStroops",
  );
});
