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
  APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
  checkAppraisalContentType,
  isJsonContentType,
  takeAppraisalRequestBody,
} from "./body-limit.js";
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

describe("appraisal JSON Content-Type enforcement", () => {
  test("accepts application/json with and without UTF-8 charset parameters", () => {
    for (const ct of [
      "application/json",
      "Application/JSON",
      "application/json; charset=utf-8",
      "application/json; charset=UTF-8",
      'application/json; charset="utf-8"',
      "application/json;charset=utf8",
    ]) {
      assert.equal(isJsonContentType(ct), true, `expected ${ct} to pass`);
      assert.equal(
        checkAppraisalContentType({ headers: { "content-type": ct } }),
        null,
      );
    }
  });

  test("rejects missing, non-JSON, or unsupported charset media types with stable 415", () => {
    for (const ct of [
      undefined,
      "",
      "   ",
      "text/plain",
      "text/html; charset=utf-8",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=---",
      "application/xml",
      "application/json; charset=iso-8859-1",
      "application/json; invalid-param",
    ]) {
      assert.equal(isJsonContentType(ct), false, `expected ${String(ct)} to fail`);
      const rejected = checkAppraisalContentType({
        headers: ct === undefined ? {} : { "content-type": ct },
      });
      assert.deepEqual(rejected, {
        status: 415,
        body: {
          error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
          expected: "application/json",
        },
      });
    }
  });

  test("POST /appraise returns 415 for non-JSON requests and 402 quote for JSON with charset", async () => {
    const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
    const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
    const server = await buildAppraisalServer({
      facilitatorSecret: facilitator.secret(),
      payTo: payee.publicKey(),
      asset: USDC_TESTNET_ADDRESS,
      price: 0.1,
      network: STELLAR_TESTNET_CAIP2,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: "https://soroban-testnet.stellar.org",
      port: 0,
    });
    const port = await listen(server);
    try {
      const textPlain = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(textPlain.status, 415);
      assert.deepEqual(await textPlain.json(), {
        error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
        expected: "application/json",
      });

      const withCharset = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(withCharset.status, 402);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
