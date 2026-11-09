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
  APPRAISAL_RESPONSE_SECURITY_HEADERS,
  APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
  buildAppraisalServer,
  isJsonContentType,
  withNonCacheableHeaders,
} from "./server.js";
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

describe("appraisal response non-cacheable headers", () => {
  test("withNonCacheableHeaders enforces Cache-Control: no-store and safe headers", () => {
    const merged = withNonCacheableHeaders({
      "Cache-Control": "public, max-age=3600",
      "X-Payment-Response": "settled",
    });
    assert.equal(merged["cache-control"], "no-store");
    assert.equal(merged["pragma"], "no-cache");
    assert.equal(merged["expires"], "0");
    assert.equal(merged["x-content-type-options"], "nosniff");
    assert.equal(merged["x-payment-response"], "settled");
    assert.deepEqual(APPRAISAL_RESPONSE_SECURITY_HEADERS, {
      "cache-control": "no-store",
      pragma: "no-cache",
      expires: "0",
      "x-content-type-options": "nosniff",
    });
  });

  test("402 quote challenges and error responses carry Cache-Control: no-store and safe headers", async () => {
    const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
    const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
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
      { nowSeconds: () => 1_700_000_000 },
    );
    const port = await listen(server);
    try {
      const challenge = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(challenge.status, 402);
      assert.equal(challenge.headers.get("cache-control"), "no-store");
      assert.equal(challenge.headers.get("pragma"), "no-cache");
      assert.equal(challenge.headers.get("expires"), "0");
      assert.equal(challenge.headers.get("x-content-type-options"), "nosniff");

      const emptyPost = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
      assert.equal(emptyPost.status, 400);
      assert.equal(emptyPost.headers.get("cache-control"), "no-store");
      assert.equal(emptyPost.headers.get("pragma"), "no-cache");
      assert.equal(emptyPost.headers.get("x-content-type-options"), "nosniff");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe("appraisal request JSON content-type enforcement", () => {
  test("isJsonContentType accepts application/json with optional UTF-8 charset and rejects non-JSON", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("APPLICATION/JSON"), true);
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
    assert.equal(isJsonContentType("application/json; charset=UTF-8"), true);
    assert.equal(isJsonContentType('application/json; charset="utf-8"'), true);
    assert.equal(isJsonContentType(["application/json; charset=utf-8"]), true);

    assert.equal(isJsonContentType(undefined), false);
    assert.equal(isJsonContentType(""), false);
    assert.equal(isJsonContentType("text/plain"), false);
    assert.equal(isJsonContentType("application/x-www-form-urlencoded"), false);
    assert.equal(isJsonContentType("multipart/form-data; boundary=abc"), false);
    assert.equal(isJsonContentType("application/json; charset=iso-8859-1"), false);
    assert.equal(isJsonContentType("application/json; boundary=abc"), false);
    assert.equal(isJsonContentType(["application/json", "text/plain"]), false);
  });

  test("POST /appraise rejects missing or non-JSON content types with 415 and accepts application/json (+ charset=utf-8)", async () => {
    const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
    const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
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
      { nowSeconds: () => 1_700_000_000 },
    );
    const port = await listen(server);
    try {
      const missingHeader = await httpPostWithoutContentType(
        port,
        "/appraise",
        JSON.stringify(validRequest.value),
      );
      assert.equal(missingHeader.status, 415);
      assert.deepEqual(missingHeader.body, {
        error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
        message: "Content-Type must be application/json",
      });

      const wrongContentType = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(wrongContentType.status, 415);
      assert.equal(wrongContentType.headers.get("cache-control"), "no-store");
      assert.deepEqual(await wrongContentType.json(), {
        error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
        message: "Content-Type must be application/json",
      });

      const formEncoded = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "itemRef=sub-rosa%3A%2F%2Fgrant%2F42&basePrice=100",
      });
      assert.equal(formEncoded.status, 415);

      const validPlainJson = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(validPlainJson.status, 402);

      const validCharsetJson = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(validCharsetJson.status, 402);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

function httpPostWithoutContentType(
  port: number,
  path: string,
  payload: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-length": String(Buffer.byteLength(payload, "utf8")),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
