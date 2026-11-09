// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { describe, test } from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";

import {
  APPRAISAL_RATE_LIMIT_EXCEEDED,
  createInMemoryQuoteRateLimiter,
  type QuoteRateLimiter,
} from "./rate-limit.js";
import { buildAppraisalServer } from "./server.js";
import { validRequest } from "./fixtures/index.js";

function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP port");
    }
    return address.port;
  });
}

describe("createInMemoryQuoteRateLimiter (deterministic clock, no sleeps)", () => {
  test("enforces maxRequests per window and resets deterministically when clock advances", () => {
    let nowMs = 1_700_000_000_000;
    const limiter = createInMemoryQuoteRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: () => nowMs,
    });

    const first = limiter.check("client-a");
    assert.equal(first.allowed, true);
    assert.equal(first.limit, 2);
    assert.equal(first.remaining, 1);
    assert.equal(first.retryAfterSeconds, 0);

    nowMs += 15_000;
    const second = limiter.check("client-a");
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);

    nowMs += 5_000;
    const third = limiter.check("client-a");
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
    assert.equal(third.retryAfterSeconds, 40);

    // Independent client key is unaffected.
    const otherClient = limiter.check("client-b");
    assert.equal(otherClient.allowed, true);
    assert.equal(otherClient.remaining, 1);

    // Advance simulated clock past the 60s window for client-a.
    nowMs += 40_000;
    const afterReset = limiter.check("client-a");
    assert.equal(afterReset.allowed, true);
    assert.equal(afterReset.remaining, 1);
  });

  test("bounds tracked client keys in memory via eviction", () => {
    let nowMs = 1_700_000_000_000;
    const limiter = createInMemoryQuoteRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      maxKeys: 2,
      nowMs: () => nowMs,
    });

    assert.equal(limiter.check("k1").allowed, true);
    assert.equal(limiter.check("k2").allowed, true);
    // Refresh k1 so k2 becomes the oldest key when k3 arrives.
    assert.equal(limiter.check("k1").allowed, false);

    // Inserting k3 evicts k2 because maxKeys=2.
    assert.equal(limiter.check("k3").allowed, true);
    // k1 is still tracked and rate-limited.
    assert.equal(limiter.check("k1").allowed, false);
    // k2 was evicted, so a fresh request for k2 is allowed.
    assert.equal(limiter.check("k2").allowed, true);
  });
});

describe("appraisal server quote rate limiting", () => {
  const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
  const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));

  test("returns 429 with rate-limit headers when quote creation exceeds limit and recovers after window", async () => {
    let nowSeconds = 1_700_000_000;
    const server = await buildAppraisalServer(
      {
        facilitatorSecret: facilitator.secret(),
        payTo: payee.publicKey(),
        asset: USDC_TESTNET_ADDRESS,
        price: 0.1,
        network: STELLAR_TESTNET_CAIP2,
        networkPassphrase: Networks.TESTNET,
        rpcUrl: "https://soroban-testnet.stellar.org",
        port: 0,
      },
      {
        nowSeconds: () => nowSeconds,
        rateLimit: {
          maxRequests: 2,
          windowMs: 60_000,
        },
      },
    );

    const port = await listen(server);
    try {
      const postQuote = () =>
        fetch(`http://127.0.0.1:${port}/appraise`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(validRequest.value),
        });

      const first = await postQuote();
      assert.equal(first.status, 402);
      assert.equal(first.headers.get("x-ratelimit-limit"), "2");
      assert.equal(first.headers.get("x-ratelimit-remaining"), "1");

      nowSeconds += 10;
      const second = await postQuote();
      assert.equal(second.status, 402);
      assert.equal(second.headers.get("x-ratelimit-limit"), "2");
      assert.equal(second.headers.get("x-ratelimit-remaining"), "0");

      nowSeconds += 5;
      const third = await postQuote();
      assert.equal(third.status, 429);
      assert.equal(third.headers.get("retry-after"), "45");
      assert.equal(third.headers.get("x-ratelimit-limit"), "2");
      assert.equal(third.headers.get("x-ratelimit-remaining"), "0");
      assert.equal(third.headers.get("cache-control"), "no-store");
      const thirdBody = (await third.json()) as Record<string, unknown>;
      assert.equal(thirdBody.error, APPRAISAL_RATE_LIMIT_EXCEEDED);
      assert.equal(thirdBody.limit, 2);
      assert.equal(thirdBody.remaining, 0);
      assert.equal(thirdBody.retryAfterSeconds, 45);

      // Advance simulated clock past the 60s window without sleeping.
      nowSeconds += 45;
      const fourth = await postQuote();
      assert.equal(fourth.status, 402);
      assert.equal(fourth.headers.get("x-ratelimit-remaining"), "1");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("supports custom async production QuoteRateLimiter adapter boundary", async () => {
    const seenKeys: string[] = [];
    const customAdapter: QuoteRateLimiter = {
      async check(key) {
        seenKeys.push(key);
        return {
          allowed: false,
          limit: 100,
          remaining: 0,
          retryAfterSeconds: 12,
          resetAtSeconds: 1_700_000_012,
        };
      },
    };

    const server = await buildAppraisalServer(
      {
        facilitatorSecret: facilitator.secret(),
        payTo: payee.publicKey(),
        asset: USDC_TESTNET_ADDRESS,
        price: 0.1,
        network: STELLAR_TESTNET_CAIP2,
        networkPassphrase: Networks.TESTNET,
        rpcUrl: "https://soroban-testnet.stellar.org",
        port: 0,
      },
      {
        rateLimiter: customAdapter,
        resolveClientKey: () => "tenant:alpha",
      },
    );

    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("retry-after"), "12");
      assert.deepEqual(seenKeys, ["tenant:alpha"]);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
