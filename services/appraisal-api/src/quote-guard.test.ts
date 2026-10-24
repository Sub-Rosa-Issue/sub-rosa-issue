// Copyright (c) 2026 Sub Rosa contributors
// Fixture-driven quote + body guards — no live x402 endpoint.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import {
  AppraisalInputError,
  assertAppraisalBodyBytes,
  buildAppraisalQuote,
  MAX_APPRAISAL_BODY_BYTES,
  parseAppraisalRequest,
} from "./appraisal.js";
import {
  AppraisalQuoteRefusalError,
  assertPaidRequestBodyAllowed,
  assertPaymentQuoteAllowed,
  createPaidFetch,
  DEFAULT_RPC_TIMEOUT_MS,
  type PaidClientTimeoutScheduler,
} from "./client.js";
import { validRequest } from "./fixtures/index.js";

const ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PAY_TO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_700_000_000;

describe("appraisal quote shape (asset, amount, destination, expiry)", () => {
  test("buildAppraisalQuote includes all four binding fields", () => {
    const quote = buildAppraisalQuote({
      asset: ASSET,
      price: 0.1,
      destination: PAY_TO,
      nowSeconds: NOW,
    });
    assert.equal(quote.asset, ASSET);
    assert.equal(quote.amount, String(1_000_000));
    assert.equal(quote.destination, PAY_TO);
    assert.equal(quote.expiresAt, NOW + 60);
  });

  test("quote amount is stroops-safe and expiry is in the future", () => {
    const quote = buildAppraisalQuote({
      asset: ASSET,
      price: 0.25,
      destination: PAY_TO,
      nowSeconds: NOW,
      ttlSeconds: 120,
    });
    assert.equal(quote.amount, String(2_500_000));
    assert.ok(quote.expiresAt > NOW);
  });
});

describe("appraisal body guards (empty / oversized / credentials)", () => {
  test("empty bodies produce a stable error", () => {
    assert.throws(() => assertAppraisalBodyBytes(""), AppraisalInputError);
    assert.throws(() => assertAppraisalBodyBytes(Buffer.alloc(0)), AppraisalInputError);
    assert.throws(
      () => assertPaidRequestBodyAllowed({ method: "POST", body: "" } as RequestInit),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_EMPTY",
    );
  });

  test("oversized bodies produce a stable error", () => {
    const big = "x".repeat(MAX_APPRAISAL_BODY_BYTES + 1);
    assert.throws(() => assertAppraisalBodyBytes(big), AppraisalInputError);
    assert.throws(
      () => assertPaidRequestBodyAllowed({ method: "POST", body: big } as RequestInit),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_OVERSIZED",
    );
  });

  test("credential-like fields fail closed with a stable error", () => {
    const withSecret = { ...(validRequest.value as object), apiKey: "sk-live" };
    assert.throws(() => parseAppraisalRequest(withSecret), AppraisalInputError);
    assert.throws(
      () =>
        assertPaidRequestBodyAllowed({
          method: "POST",
          body: JSON.stringify({ ...(validRequest.value as object), secret: "s" }),
        } as RequestInit),
      (e: unknown) =>
        e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_CREDENTIALS",
    );
  });

  test("valid fixture body passes", () => {
    assert.doesNotThrow(() =>
      assertPaidRequestBodyAllowed({
        method: "POST",
        body: JSON.stringify(validRequest.value),
      } as RequestInit),
    );
  });
});

describe("402 quote binding (pure, fixture-driven)", () => {
  const expected = {
    asset: ASSET,
    destination: PAY_TO,
    maxAmountStroops: 1_000_000n,
    nowSeconds: NOW,
  };
  const base402 = {
    accepts: [
      {
        asset: ASSET,
        payTo: PAY_TO,
        amount: "0.10",
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  };

  test("matching quote passes", () => {
    assert.doesNotThrow(() => assertPaymentQuoteAllowed(base402, expected));
  });

  test("quote above the cap is refused", () => {
    const drifted = {
      accepts: [{ ...base402.accepts[0], amount: "0.25" }],
    };
    assert.throws(
      () => assertPaymentQuoteAllowed(drifted, expected),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXCEEDS_CAP",
    );
  });

  test("asset mismatch fails closed", () => {
    const other = {
      accepts: [{ ...base402.accepts[0], asset: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }],
    };
    assert.throws(
      () => assertPaymentQuoteAllowed(other, expected),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_ASSET_MISMATCH",
    );
  });

  test("destination mismatch fails closed", () => {
    const other = {
      accepts: [{ ...base402.accepts[0], payTo: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }],
    };
    assert.throws(
      () => assertPaymentQuoteAllowed(other, expected),
      (e: unknown) =>
        e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_DESTINATION_MISMATCH",
    );
  });

  test("expired quote is refused", () => {
    const expired = {
      accepts: [{ ...base402.accepts[0], maxTimeoutSeconds: 0 }],
    };
    assert.throws(
      () => assertPaymentQuoteAllowed(expired, expected),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXPIRED",
    );
    assert.throws(
      () => assertPaymentQuoteAllowed(base402, { ...expected, expiresAt: NOW - 1 }),
      (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXPIRED",
    );
  });

  test("refusal carries a trace-safe record", () => {
    try {
      assertPaymentQuoteAllowed(
        { accepts: [{ ...base402.accepts[0], amount: "9.99" }] },
        expected,
      );
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof AppraisalQuoteRefusalError);
      const record = e.toTraceRecord();
      assert.equal(record.type, "appraisal-quote-refusal");
      assert.equal(record.code, "QUOTE_EXCEEDS_CAP");
      assert.ok(typeof record.message === "string" && record.message.length > 0);
    }
  });
});

describe("paid fetch never produces a payment transaction on drift (mocked fetch)", () => {
  const secret = Keypair.random().secret();

  function mock402ThenAssert(
    acceptsAmount: string,
    expectedOverride?: Partial<Parameters<typeof assertPaymentQuoteAllowed>[1]>,
  ) {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    const body402 = JSON.stringify({
      x402Version: 2,
      resource: "https://example.com/appraise",
      accepts: [
        {
          scheme: "exact",
          network: "stellar:testnet",
          payTo: PAY_TO,
          amount: acceptsAmount,
          asset: ASSET,
          maxTimeoutSeconds: 60,
          extra: {},
        },
      ],
    });
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(body402, { status: 402, headers: { "content-type": "application/json" } });
      }
      throw new Error("paid second fetch must not happen on drift");
    }) as typeof fetch;
    return {
      calls: () => calls,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
      body402,
    };
  }

  test("over-cap quote never reaches the paid second fetch", async () => {
    const paidFetch = createPaidFetch({
      secret,
      expectedQuote: {
        asset: ASSET,
        destination: PAY_TO,
        maxAmountStroops: 1_000_000n,
        nowSeconds: NOW,
      },
    });
    const m = mock402ThenAssert("0.25");
    // Stub the x402 client parsing to return our fixture 402 without network crypto.
    const { x402HTTPClient } = await import("@x402/core/client");
    const origParse = x402HTTPClient.prototype.getPaymentRequiredResponse;
    const origPayload = x402HTTPClient.prototype.createPaymentPayload;
    x402HTTPClient.prototype.getPaymentRequiredResponse = (() =>
      JSON.parse(m.body402)) as never;
    x402HTTPClient.prototype.createPaymentPayload = (async () => {
      throw new Error("must not build a payment payload on drift");
    }) as never;
    try {
      await assert.rejects(
        () =>
          paidFetch("https://example.com/appraise", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validRequest.value),
          }),
        (e: unknown) => e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_EXCEEDS_CAP",
      );
      assert.equal(m.calls(), 1);
    } finally {
      m.restore();
      x402HTTPClient.prototype.getPaymentRequiredResponse = origParse;
      x402HTTPClient.prototype.createPaymentPayload = origPayload;
    }
  });

  test("oversized body produces a stable error with no fetch at all", async () => {
    const paidFetch = createPaidFetch({ secret });
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("no fetch expected for oversized body");
    }) as typeof fetch;
    try {
      await assert.rejects(
        () =>
          paidFetch("https://example.com/appraise", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "x".repeat(MAX_APPRAISAL_BODY_BYTES + 1),
          }),
        (e: unknown) =>
          e instanceof AppraisalQuoteRefusalError && e.code === "QUOTE_BODY_OVERSIZED",
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("bounds stalled appraisal requests with DEFAULT_RPC_TIMEOUT_MS", async () => {
    assert.equal(DEFAULT_RPC_TIMEOUT_MS, 10_000);
    let scheduledDelay = 0;
    let triggerTimeout: (() => void) | undefined;
    let cleared = false;
    const scheduler: PaidClientTimeoutScheduler = {
      setTimeout(cb, delayMs) {
        scheduledDelay = delayMs;
        triggerTimeout = cb;
        return 1;
      },
      clear() {
        cleared = true;
      },
    };
    let aborted = false;

    const paidFetch = createPaidFetch({
      secret,
      scheduler,
      fetchImpl: ((_input, init) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    });

    const pending = paidFetch("https://example.com/appraise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRequest.value),
    });

    assert.equal(scheduledDelay, DEFAULT_RPC_TIMEOUT_MS);
    assert.equal(aborted, false);

    triggerTimeout?.();
    await assert.rejects(pending, /appraisal request timed out after 10000ms/);
    assert.equal(aborted, true);
    assert.equal(cleared, true);
  });
});
