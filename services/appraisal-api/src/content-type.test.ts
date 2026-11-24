// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { describe, test } from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";

import {
  APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
  appraisalUnsupportedMediaTypeBody,
  isAppraisalJsonContentType,
} from "./content-type.js";
import { validRequest } from "./fixtures/index.js";
import { buildAppraisalServer } from "./server.js";

describe("isAppraisalJsonContentType", () => {
  test("accepts application/json with and without a UTF-8 charset", () => {
    for (const header of [
      "application/json",
      "application/json; charset=utf-8",
      "application/json;charset=utf-8",
      "application/json ; charset=UTF-8",
      'application/json; charset="utf-8"',
      "APPLICATION/JSON; CHARSET=Utf-8",
      "application/json; charset=utf8",
      "application/json; boundary=ignored",
    ]) {
      assert.equal(isAppraisalJsonContentType(header), true, header);
    }
  });

  test("rejects a missing header and every other media type", () => {
    for (const header of [
      undefined,
      "",
      " ",
      "text/plain",
      "text/json",
      "text/html",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=abc",
      "application/xml",
      "application/jsonp",
      "application/jsonx",
      "application/json-patch+json",
      "application/vnd.api+json",
      "application/json,text/html",
      "json",
    ]) {
      assert.equal(isAppraisalJsonContentType(header), false, String(header));
    }
  });

  test("rejects a JSON type whose charset the server cannot decode", () => {
    for (const header of [
      "application/json; charset=iso-8859-1",
      "application/json; charset=utf-16",
      'application/json; charset="latin1"',
      "application/json; charset=",
    ]) {
      assert.equal(isAppraisalJsonContentType(header), false, header);
    }
  });

  test("the 415 body is stable", () => {
    assert.deepEqual(appraisalUnsupportedMediaTypeBody(), {
      error: "unsupported_media_type",
      expected: "application/json",
    });
    assert.equal(APPRAISAL_UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type");
  });
});

async function startServer(): Promise<{ server: http.Server; url: string }> {
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP port");
  return { server, url: `http://127.0.0.1:${address.port}/appraise` };
}

describe("POST /appraise media type", () => {
  test("returns a stable 415 for unsupported media types, before any payment offer", async () => {
    const { server, url } = await startServer();
    try {
      for (const headers of [
        { "content-type": "text/plain" },
        { "content-type": "application/x-www-form-urlencoded" },
        { "content-type": "application/json; charset=iso-8859-1" },
        {} as Record<string, string>,
      ]) {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(validRequest.value),
        });
        const label = JSON.stringify(headers);
        assert.equal(res.status, 415, label);
        assert.deepEqual(await res.json(), appraisalUnsupportedMediaTypeBody(), label);
        assert.equal(res.headers.get("accept-post"), "application/json", label);
        assert.equal(res.headers.get("cache-control"), "no-store", label);
        assert.equal(res.headers.get("x-content-type-options"), "nosniff", label);
        assert.equal(res.headers.get("payment-required"), null, "no payment quote on a 415");
      }
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("an empty body with an unsupported type is 415, not 400 or 402", async () => {
    const { server, url } = await startServer();
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "" });
      assert.equal(res.status, 415);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("valid JSON with a charset parameter still reaches the payment challenge", async () => {
    const { server, url } = await startServer();
    try {
      for (const contentType of ["application/json", "application/json; charset=utf-8"]) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": contentType },
          body: JSON.stringify(validRequest.value),
        });
        assert.equal(res.status, 402, contentType);
      }
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("a supported type with an invalid body keeps its existing 400", async () => {
    const { server, url } = await startServer();
    try {
      const bad = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: "{not json",
      });
      assert.equal(bad.status, 400);
      const empty = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
      assert.equal(empty.status, 400);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
