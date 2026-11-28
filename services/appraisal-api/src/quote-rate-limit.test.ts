// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";

import {
  appraisalQuoteRateKey,
  createMemoryQuoteRateLimiter,
  normalizeClientIp,
  type QuoteRateLimiter,
} from "./quote-rate-limit.js";
import { buildAppraisalServer, formatRetryAfterSeconds } from "./server.js";
import { validRequest } from "./fixtures/index.js";

const OPTIONS = { limit: 2, windowMs: 1_000, maxKeys: 2 };

test("allows quotes inside the window and refuses the next one", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.deepEqual(limiter.take("client-a", 0), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.take("client-a", 100), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.take("client-a", 200), { allowed: false, retryAfterMs: 800 });
});

test("a refused call does not mint an extra quote slot", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  limiter.take("client-a", 2);
  assert.equal(limiter.take("client-a", 3).allowed, false);
});

test("another key has its own window", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  assert.equal(limiter.take("client-b", 2).allowed, true);
});

test("advancing the clock opens a new window", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  assert.equal(limiter.take("client-a", 1_000).allowed, true);
});

test("the key map is bounded and fail-closed for a new key", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.equal(limiter.take("one", 0).allowed, true);
  assert.equal(limiter.take("two", 0).allowed, true);
  assert.deepEqual(limiter.take("three", 0), { allowed: false, retryAfterMs: 1_000 });
});

test("a non-finite clock refuses the quote", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.equal(limiter.take("client-a", Number.NaN).allowed, false);
});

test("a production adapter can replace the memory limiter", () => {
  const production: QuoteRateLimiter = {
    take() {
      return { allowed: false, retryAfterMs: 5_000 };
    },
  };
  assert.deepEqual(production.take("client-a", 10), {
    allowed: false,
    retryAfterMs: 5_000,
  });
});

test("formatRetryAfterSeconds rounds safely to positive integer seconds", () => {
  assert.equal(formatRetryAfterSeconds(1), "1");
  assert.equal(formatRetryAfterSeconds(1_000), "1");
  assert.equal(formatRetryAfterSeconds(1_001), "2");
  assert.equal(formatRetryAfterSeconds(0), "1");
  assert.equal(formatRetryAfterSeconds(-500), "1");
  assert.equal(formatRetryAfterSeconds(Number.NaN, 15_000), "15");
  assert.equal(formatRetryAfterSeconds(Number.POSITIVE_INFINITY, 15_000), "15");
});

test("normalizeClientIp normalizes IPv4, IPv4-mapped IPv6, bracketed IPv6, and ports", () => {
  assert.equal(normalizeClientIp(" 192.0.2.10 "), "192.0.2.10");
  assert.equal(normalizeClientIp("192.0.2.10:54321"), "192.0.2.10");
  assert.equal(normalizeClientIp("::ffff:192.0.2.10"), "192.0.2.10");
  assert.equal(normalizeClientIp("::FFFF:192.0.2.10"), "192.0.2.10");
  assert.equal(normalizeClientIp("[2001:DB8::1]:8443"), "2001:db8::1");
  assert.equal(normalizeClientIp("2001:DB8::1"), "2001:db8::1");
  assert.equal(normalizeClientIp("not-an-ip"), "");
});

function fakeReq(
  remoteAddress: string | undefined,
  forwardedFor?: string | string[],
): http.IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  } as unknown as http.IncomingMessage;
}

test("appraisalQuoteRateKey ignores X-Forwarded-For by default (anti-spoofing)", () => {
  const req1 = fakeReq("::ffff:10.0.0.5", "203.0.113.1");
  const req2 = fakeReq("10.0.0.5", "203.0.113.2");
  assert.equal(appraisalQuoteRateKey(req1), "10.0.0.5");
  assert.equal(appraisalQuoteRateKey(req2), "10.0.0.5");
});

test("appraisalQuoteRateKey honors and normalizes X-Forwarded-For only when the actual peer is trusted", () => {
  const req = fakeReq("127.0.0.1", "10.0.0.1, ::ffff:198.51.100.7");
  assert.equal(appraisalQuoteRateKey(req, { trustedProxyIps: ["127.0.0.1"] }), "198.51.100.7");

  const ipv6Req = fakeReq("127.0.0.1", "10.0.0.1, [2001:DB8::42]:443");
  assert.equal(appraisalQuoteRateKey(ipv6Req, { trustedProxyIps: ["127.0.0.1"] }), "2001:db8::42");

  const spoofedInvalid = fakeReq("::ffff:10.0.0.9", "192.0.2.99");
  assert.equal(appraisalQuoteRateKey(spoofedInvalid, { trustedProxyIps: ["127.0.0.1"] }), "10.0.0.9");
});

test("HTTP 429 includes Retry-After from remaining window, keeps JSON shape, resets at boundary, and ignores untrusted X-Forwarded-For", async () => {
  let nowSec = 1_700_000_000;
  const { x402HTTPResourceServer } = await import("@x402/core/server");
  const origProcess = x402HTTPResourceServer.prototype.processHTTPRequest;
  const origSettle = x402HTTPResourceServer.prototype.processSettlement;
  x402HTTPResourceServer.prototype.processHTTPRequest = (async () => ({
    type: "payment-verified",
    paymentPayload: {},
    paymentRequirements: {},
    declaredExtensions: undefined,
  })) as never;
  x402HTTPResourceServer.prototype.processSettlement = (async () => ({
    success: true,
    headers: {},
    transaction: "tx-test",
    network: STELLAR_TESTNET_CAIP2,
    payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  })) as never;

  const facilitator = Keypair.random();
  const payee = Keypair.random();
  const server = await buildAppraisalServer(
    {
      facilitatorSecret: facilitator.secret(),
      payTo: payee.publicKey(),
      asset: USDC_TESTNET_ADDRESS,
      price: 0.1,
      network: STELLAR_TESTNET_CAIP2,
      rpcUrl: "http://localhost:8000/rpc",
      port: 0,
      trustedProxyIps: [],
    },
    {
      nowSeconds: () => nowSec,
      quoteRateLimiter: createMemoryQuoteRateLimiter({ limit: 1, windowMs: 10_000, maxKeys: 10 }),
      facilitatorClient: {
        verify: async () => ({ isValid: true }),
        settle: async () => ({ success: true, transaction: "tx", network: STELLAR_TESTNET_CAIP2 }),
        getSupported: async () => ({
          kinds: [{ x402Version: 2, scheme: "exact", network: STELLAR_TESTNET_CAIP2 }],
        }),
      } as never,
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/appraise`;
  const postAppraise = (forwardedFor?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
      body: JSON.stringify(validRequest.value),
    });

  try {
    const first = await postAppraise("203.0.113.1");
    assert.equal(first.status, 200);

    // Rotating X-Forwarded-For without trusted proxies still hits the same limit.
    nowSec += 3;
    const limited = await postAppraise("203.0.113.99");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "7");
    assert.deepEqual(await limited.json(), { error: "appraisal quote rate limit exceeded" });

    // Just before the reset boundary (9s elapsed of 10s window -> 1s remaining).
    nowSec += 6;
    const beforeBoundary = await postAppraise("203.0.113.100");
    assert.equal(beforeBoundary.status, 429);
    assert.equal(beforeBoundary.headers.get("retry-after"), "1");

    // At the exact reset boundary (10s elapsed), a new window opens.
    nowSec += 1;
    const afterBoundary = await postAppraise("203.0.113.100");
    assert.equal(afterBoundary.status, 200);
  } finally {
    x402HTTPResourceServer.prototype.processHTTPRequest = origProcess;
    x402HTTPResourceServer.prototype.processSettlement = origSettle;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
