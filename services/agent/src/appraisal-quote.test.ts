// Copyright (c) 2026 Sub Rosa contributors
// Mandate-bound appraisal quote refusal — fixtures only, no live x402 endpoint.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";
import { createFakeTime } from "@sub-rosa/time";
import { APPRAISAL_MODEL } from "@sub-rosa/appraisal-api";

import {
  AppraisalQuoteRefusalError,
  assertAppraisalQuoteAllowed,
  assertAppraisalRequestBodyAllowed,
  createSessionMandate,
  usdcToStroops,
} from "./mandate.js";
import { runBidderAgent, type BidderAgentConfig, type BidderDependencies } from "./bidder.js";
import type { Round } from "@sub-rosa/sdk";

const ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PAY_TO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function mandateFixture() {
  const { clock } = createFakeTime(1_700_000_000_000);
  const now = clock.nowSeconds();
  const { mandate, sessionSecret } = createSessionMandate({
    principalSecret: Keypair.random().secret(),
    contractId: "C".repeat(56),
    roundId: 7n,
    itemRef: "sub-rosa://test",
    basePriceUsdc: 100,
    category: "rfp",
    maxBidStroops: usdcToStroops(200),
    maxEscrowStroops: usdcToStroops(200),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    appraisalAsset: ASSET,
    appraisalPayTo: PAY_TO,
    commitDeadline: now + 3600,
    clock,
  });
  return { mandate, sessionSecret, clock, now };
}

describe("assertAppraisalQuoteAllowed (mandate binding)", () => {
  test("matching quote passes", () => {
    const { mandate, now } = mandateFixture();
    assert.doesNotThrow(() =>
      assertAppraisalQuoteAllowed(
        mandate,
        { asset: ASSET, amount: String(usdcToStroops(0.1)), destination: PAY_TO, expiresAt: now + 60 },
        { nowSeconds: now },
      ),
    );
  });

  test("quote above the mandate cap is refused", () => {
    const { mandate, now } = mandateFixture();
    assert.throws(
      () =>
        assertAppraisalQuoteAllowed(
          mandate,
          { asset: ASSET, amount: String(usdcToStroops(0.25)), destination: PAY_TO, expiresAt: now + 60 },
          { nowSeconds: now },
        ),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXCEEDS_CAP",
    );
  });

  test("asset mismatch fails closed", () => {
    const { mandate, now } = mandateFixture();
    assert.throws(
      () =>
        assertAppraisalQuoteAllowed(
          mandate,
          { asset: "CDIFFERENT", amount: String(usdcToStroops(0.1)), destination: PAY_TO, expiresAt: now + 60 },
          { nowSeconds: now },
        ),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_ASSET_MISMATCH",
    );
  });

  test("destination mismatch fails closed", () => {
    const { mandate, now } = mandateFixture();
    assert.throws(
      () =>
        assertAppraisalQuoteAllowed(
          mandate,
          { asset: ASSET, amount: String(usdcToStroops(0.1)), destination: "GDIFFERENT", expiresAt: now + 60 },
          { nowSeconds: now },
        ),
      (e: unknown) =>
        e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_DESTINATION_MISMATCH",
    );
  });

  test("expired quote is refused", () => {
    const { mandate, now } = mandateFixture();
    assert.throws(
      () =>
        assertAppraisalQuoteAllowed(
          mandate,
          { asset: ASSET, amount: String(usdcToStroops(0.1)), destination: PAY_TO, expiresAt: now - 1 },
          { nowSeconds: now },
        ),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXPIRED",
    );
  });

  test("cumulative spend over the session cap is refused", () => {
    const { mandate, now } = mandateFixture();
    assert.throws(
      () =>
        assertAppraisalQuoteAllowed(
          mandate,
          { asset: ASSET, amount: String(usdcToStroops(0.1)), destination: PAY_TO, expiresAt: now + 60 },
          { spentSoFarStroops: usdcToStroops(0.95), nowSeconds: now },
        ),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_SPEND_EXCEEDED",
    );
  });

  test("refusal records a trace-safe typed record", () => {
    const { mandate, now } = mandateFixture();
    try {
      assertAppraisalQuoteAllowed(
        mandate,
        { asset: "COTHER", amount: String(usdcToStroops(0.1)), destination: PAY_TO, expiresAt: now + 60 },
        { nowSeconds: now },
      );
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof AppraisalQuoteRefusalError);
      assert.equal(e.code, "QUOTE_ASSET_MISMATCH");
      const record = e.toTraceRecord();
      assert.equal(record.type, "appraisal-quote-refusal");
      assert.equal(record.code, "QUOTE_ASSET_MISMATCH");
      // Keeper trace renders JSON — must be serializable.
      assert.doesNotThrow(() => JSON.stringify(record));
    }
  });
});

describe("assertAppraisalRequestBodyAllowed (no payment on unsafe bodies)", () => {
  test("empty body is refused", () => {
    assert.throws(
      () => assertAppraisalRequestBodyAllowed(""),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_EMPTY",
    );
  });

  test("oversized body is refused with a stable error", () => {
    assert.throws(
      () => assertAppraisalRequestBodyAllowed("x".repeat(8192 + 1)),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_OVERSIZED",
    );
  });

  test("credential-like fields are refused", () => {
    assert.throws(
      () =>
        assertAppraisalRequestBodyAllowed(
          JSON.stringify({ itemRef: "x", basePrice: 1, secret: "s" }),
        ),
      (e: unknown) =>
        e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_CREDENTIALS",
    );
  });
});

describe("runBidderAgent refuses drifted quotes without sealing or committing", () => {
  function bidderHarness(quoteOverride?: Partial<{ asset: string; amount: string; destination: string; expiresAt: number }>) {
    const { clock } = createFakeTime(1_700_000_000_000);
    const now = clock.nowSeconds();
    const { mandate, sessionSecret } = createSessionMandate({
      principalSecret: Keypair.random().secret(),
      contractId: "C".repeat(56),
      roundId: 7n,
      itemRef: "sub-rosa://test",
      basePriceUsdc: 100,
      category: "rfp",
      maxBidStroops: usdcToStroops(200),
      maxEscrowStroops: usdcToStroops(200),
      maxAppraisalSpendStroops: usdcToStroops(1),
      appraisalPriceStroops: usdcToStroops(0.1),
      appraisalAsset: ASSET,
      appraisalPayTo: PAY_TO,
      commitDeadline: now + 3600,
      clock,
    });
    const config: BidderAgentConfig = {
      mandate,
      sessionSecret,
      clock,
      rpcUrl: "https://rpc.invalid",
      networkPassphrase: "test",
      appraisalUrl: "https://appraisal.invalid",
      auditorPubkey: new Uint8Array(96).fill(7),
      revealRound: 123,
      attributes: {},
      appraisalAsset: ASSET,
      appraisalPayTo: PAY_TO,
    };
    const round = {
      status: { tag: "Open", values: undefined },
      commit_deadline: BigInt(now + 3600),
      reveal_round: 123n,
      auditor_pubkey: Buffer.from(config.auditorPubkey),
    } as Round;
    const calls = { paid: 0, sealed: 0, committed: 0 };
    const quote = {
      asset: ASSET,
      amount: String(usdcToStroops(0.1)),
      destination: PAY_TO,
      expiresAt: now + 600,
      ...quoteOverride,
    };
    const deps: BidderDependencies = {
      createClient: () => ({
        getRound: async () => round,
        commit: async () => {
          calls.committed++;
        },
      }),
      createPaidFetch: () => (async <T>() => {
        calls.paid++;
        return {
          status: 200,
          body: {
            appraisal: {
              model: APPRAISAL_MODEL,
              itemRef: mandate.itemRef,
              inputsHash: "hash",
              fairValue: 50,
              low: 40,
              high: 60,
              confidence: 0.8,
              suggestedMaxBid: 50,
              rationale: [],
            },
            quote,
          } as T,
        };
      }) as ReturnType<BidderDependencies["createPaidFetch"]>,
      sealBid: (async () => {
        calls.sealed++;
        return { commitment: new Uint8Array(32), ciphertext: new Uint8Array(4), auditorBlob: new Uint8Array(4) };
      }) as BidderDependencies["sealBid"],
    };
    return { config, deps, calls };
  }

  test("matching settled quote commits", async () => {
    const h = bidderHarness();
    await runBidderAgent(h.config, h.deps);
    assert.deepEqual(h.calls, { paid: 1, sealed: 1, committed: 1 });
  });

  test("drifted amount above cap refuses before seal/commit", async () => {
    const h = bidderHarness({ amount: String(usdcToStroops(0.5)) });
    await assert.rejects(
      runBidderAgent(h.config, h.deps),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXCEEDS_CAP",
    );
    assert.deepEqual(h.calls, { paid: 1, sealed: 0, committed: 0 });
  });

  test("asset mismatch fails closed before seal/commit", async () => {
    const h = bidderHarness({ asset: "CDIFFERENT" });
    await assert.rejects(
      runBidderAgent(h.config, h.deps),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_ASSET_MISMATCH",
    );
    assert.deepEqual(h.calls, { paid: 1, sealed: 0, committed: 0 });
  });

  test("destination mismatch fails closed before seal/commit", async () => {
    const h = bidderHarness({ destination: "GDIFFERENT" });
    await assert.rejects(
      runBidderAgent(h.config, h.deps),
      (e: unknown) =>
        e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_DESTINATION_MISMATCH",
    );
    assert.deepEqual(h.calls, { paid: 1, sealed: 0, committed: 0 });
  });
});
