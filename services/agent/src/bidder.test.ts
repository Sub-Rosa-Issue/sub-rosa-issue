// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import { bidFromAppraisal, createSessionMandate, usdcToStroops } from "./mandate.js";
import { createFakeTime } from "@sub-rosa/time";

test("two agents with different appraisal inputs produce different bid sizes under same cap", () => {
  const { clock } = createFakeTime(1_700_000_000_000);
  const common = {
    contractId: "CCONTRACT123456789012345678901234567890123456789012345678901234",
    roundId: 7n,
    itemRef: "sub-rosa://rfp/x",
    basePriceUsdc: 500,
    category: "spectrum" as const,
    maxBidStroops: usdcToStroops(200),
    maxEscrowStroops: usdcToStroops(200),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: clock.nowSeconds() + 3600,
    clock,
  };

  // Suggested max bids (USDC) that stay under the shared cap and differ.
  const strongSuggested = 75;
  const weakSuggested = 35;

  const m1 = createSessionMandate({ ...common, principalSecret: Keypair.random().secret() }).mandate;
  const m2 = createSessionMandate({ ...common, principalSecret: Keypair.random().secret() }).mandate;

  const b1 = bidFromAppraisal(strongSuggested, m1);
  const b2 = bidFromAppraisal(weakSuggested, m2);
  assert.ok(b1.bidValue > b2.bidValue);
  assert.ok(b1.bidValue <= usdcToStroops(200));
  assert.ok(b2.bidValue <= usdcToStroops(200));
});

import { runBidderAgent, type BidderDependencies, type BidderAgentConfig } from "./bidder.js";
import type { Round } from "@sub-rosa/sdk";
import { APPRAISAL_MODEL } from "@sub-rosa/appraisal-api";

function bidderFixture() {
  const { clock } = createFakeTime(1_700_000_000_000);
  const now = clock.nowSeconds();
  const { mandate, sessionSecret } = createSessionMandate({
    principalSecret: Keypair.random().secret(), contractId: "C".repeat(56),
    roundId: 7n, itemRef: "sub-rosa://test", basePriceUsdc: 100, category: "rfp",
    maxBidStroops: usdcToStroops(200), maxEscrowStroops: usdcToStroops(200),
    maxAppraisalSpendStroops: usdcToStroops(1), appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: now + 3600, clock,
  });
  const config: BidderAgentConfig = {
    mandate, sessionSecret, clock, rpcUrl: "https://rpc.invalid", networkPassphrase: "test",
    appraisalUrl: "https://appraisal.invalid", auditorPubkey: new Uint8Array(96).fill(7),
    revealRound: 123, attributes: {},
  };
  const round = {
    status: { tag: "Open", values: undefined }, commit_deadline: BigInt(now + 10),
    reveal_round: 123n, auditor_pubkey: Buffer.from(config.auditorPubkey),
  } as Round;
  const calls = { paid: 0, sealed: 0, committed: 0 };
  let duringPayment = () => {};
  let duringSeal = () => {};
  const deps: BidderDependencies = {
    createClient: () => ({ getRound: async () => round, commit: async () => { calls.committed++; } }),
    createPaidFetch: () => async <T>() => {
      calls.paid++; duringPayment();
      return { status: 200, body: { appraisal: {
        model: APPRAISAL_MODEL, itemRef: mandate.itemRef, inputsHash: "hash",
        fairValue: 50, low: 40, high: 60, confidence: 0.8, suggestedMaxBid: 50, rationale: [],
      } } as T };
    },
    sealBid: async ({ round: revealRound, auditorPublicKey }) => {
      calls.sealed++; duringSeal();
      assert.equal(revealRound, 123);
      assert.deepEqual(auditorPublicKey, new Uint8Array(round.auditor_pubkey));
      return { commitment: new Uint8Array(32), ciphertext: new Uint8Array(4), auditorBlob: new Uint8Array(4) };
    },
  };
  return { config, round, calls, deps, clock,
    onPayment(fn: () => void) { duringPayment = fn; },
    onSeal(fn: () => void) { duringSeal = fn; },
  };
}

for (const [name, change, diagnostic] of [
  ["reveal round mismatch", (f: ReturnType<typeof bidderFixture>) => { f.config.revealRound++; }, /reveal round mismatch/],
  ["auditor byte mismatch", (f: ReturnType<typeof bidderFixture>) => { f.config.auditorPubkey[0]++; }, /auditor public key mismatch/],
  ["auditor length mismatch", (f: ReturnType<typeof bidderFixture>) => { f.config.auditorPubkey = new Uint8Array(95); }, /auditor public key mismatch/],
  ["closed status", (f: ReturnType<typeof bidderFixture>) => { f.round.status = { tag: "Revealing", values: undefined }; }, /not open/],
  ["at deadline", (f: ReturnType<typeof bidderFixture>) => { f.round.commit_deadline = BigInt(f.clock.nowSeconds()); }, /deadline/],
  ["past deadline", (f: ReturnType<typeof bidderFixture>) => { f.round.commit_deadline = BigInt(f.clock.nowSeconds() - 1); }, /deadline/],
  ["unsafe authoritative round", (f: ReturnType<typeof bidderFixture>) => { f.round.reveal_round = 9007199254740993n; }, /safe integer/],
] as const) {
  test(`${name} fails before payment, sealing or commit`, async () => {
    const f = bidderFixture(); change(f);
    await assert.rejects(runBidderAgent(f.config, f.deps), diagnostic);
    assert.deepEqual(f.calls, { paid: 0, sealed: 0, committed: 0 });
  });
}
for (const invalid of [NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid supplied reveal round ${invalid} fails before payment`, async () => {
    const f = bidderFixture(); f.config.revealRound = invalid;
    await assert.rejects(runBidderAgent(f.config, f.deps), /safe integer/);
    assert.deepEqual(f.calls, { paid: 0, sealed: 0, committed: 0 });
  });
}
test("window expiring during appraisal prevents sealing and commit", async () => {
  const f = bidderFixture(); f.onPayment(() => f.clock.advance(10_000));
  await assert.rejects(runBidderAgent(f.config, f.deps), /deadline/);
  assert.deepEqual(f.calls, { paid: 1, sealed: 0, committed: 0 });
});
test("window expiring during sealing prevents commit", async () => {
  const f = bidderFixture(); f.onSeal(() => f.clock.advance(10_000));
  await assert.rejects(runBidderAgent(f.config, f.deps), /deadline/);
  assert.deepEqual(f.calls, { paid: 1, sealed: 1, committed: 0 });
});
test("status closing during appraisal prevents commit", async () => {
  const f = bidderFixture(); f.onPayment(() => { f.round.status = { tag: "Revealing", values: undefined }; });
  await assert.rejects(runBidderAgent(f.config, f.deps), /not open/);
  assert.equal(f.calls.committed, 0);
});
test("matching inputs within the window retain successful bidder flow", async () => {
  const f = bidderFixture(); const result = await runBidderAgent(f.config, f.deps);
  assert.deepEqual(f.calls, { paid: 1, sealed: 1, committed: 1 });
  assert.equal(result.bidder, f.config.mandate.sessionKey);
  assert.equal(result.bidValue, usdcToStroops(50));
});
