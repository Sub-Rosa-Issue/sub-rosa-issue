// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";

import {
  APPRAISAL_BODY_TOO_LARGE,
  takeAppraisalRequestBody,
} from "./body-limit.js";
import {
  APPRAISAL_RATE_LIMITED,
  InMemoryQuoteRateLimiter,
  type AppraisalQuoteRateLimiter,
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

function fakeRequest(headers: http.IncomingHttpHeaders, body: Buffer): IncomingMessage {
  const stream = new PassThrough();
  const req = Object.assign(stream, { headers }) as unknown as IncomingMessage;
  queueMicrotask(() => {
    stream.end(body);
  });
  return req;
}

describe("appraisal request body cap", () => {
  test("rejects a declared Content-Length above the cap before the body is parsed", async () => {
    const req = fakeRequest({ "content-length": "8193" }, Buffer.from("{}"));
    const taken = await takeAppraisalRequestBody(req, 8192);
    assert.ok("status" in taken);
    assert.equal(taken.status, 413);
    assert.deepEqual(taken.body, {
      error: APPRAISAL_BODY_TOO_LARGE,
      limitBytes: 8192,
    });
  });

  test("returns 413 for an oversized stream and still parses a small JSON body", async () => {
    const server = http.createServer(async (req, res) => {
      const taken = await takeAppraisalRequestBody(req, 32);
      if ("status" in taken) {
        res.writeHead(taken.status, { "content-type": "application/json" });
        res.end(JSON.stringify(taken.body));
        return;
      }
      JSON.parse(taken.raw.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);
    try {
      const oversized = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(33),
      });
      assert.equal(oversized.status, 413);
      assert.deepEqual(await oversized.json(), {
        error: APPRAISAL_BODY_TOO_LARGE,
        limitBytes: 32,
      });

      const allowed = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
      assert.equal(allowed.status, 200);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe("appraisal quote rate limiting", () => {
  test("InMemoryQuoteRateLimiter enforces window quota and resets deterministically", () => {
    let now = 1_000_000;
    const limiter = new InMemoryQuoteRateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      maxKeys: 4,
      nowMs: () => now,
    });

    const first = limiter.consume("127.0.0.1");
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);

    const second = limiter.consume("127.0.0.1");
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);

    now += 3_000;
    const third = limiter.consume("127.0.0.1");
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
    assert.equal(third.retryAfterSeconds, 7);

    now += 7_000;
    const afterReset = limiter.consume("127.0.0.1");
    assert.equal(afterReset.allowed, true);
    assert.equal(afterReset.remaining, 1);
  });

  test("InMemoryQuoteRateLimiter bounds memory to maxKeys under key churn", () => {
    let now = 2_000_000;
    const limiter = new InMemoryQuoteRateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
      maxKeys: 3,
      nowMs: () => now,
    });

    for (let i = 0; i < 10; i++) {
      limiter.consume(`client-${i}`);
      assert.ok(limiter.size <= 3, `expected size <= 3, got ${limiter.size}`);
    }
  });

  test("POST /appraise enforces quote rate limits and supports custom production adapter", async () => {
    const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
    const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
    let calls = 0;
    const customAdapter: AppraisalQuoteRateLimiter = {
      async consume() {
        calls += 1;
        return {
          allowed: calls <= 1,
          limit: 1,
          remaining: 0,
          retryAfterSeconds: calls <= 1 ? 0 : 15,
          resetAtMs: 1_700_000_015_000,
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
      { quoteRateLimiter: customAdapter },
    );
    const port = await listen(server);
    try {
      const first = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(first.status, 402);
      assert.equal(first.headers.get("x-ratelimit-limit"), "1");

      const second = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(second.status, 429);
      assert.equal(second.headers.get("retry-after"), "15");
      assert.deepEqual(await second.json(), {
        error: APPRAISAL_RATE_LIMITED,
        retryAfterSeconds: 15,
      });
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
