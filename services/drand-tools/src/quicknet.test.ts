// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DrandResponseError, NON_JSON_RESPONSE, getBeacon, getChainInfo } from "./quicknet.js";

const realFetch = globalThis.fetch;

function respond(body: string, headers: Record<string, string>, status = 200) {
  globalThis.fetch = (async () => new Response(body, { status, headers })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const INFO = {
  public_key: "ab".repeat(96),
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  schemeID: "bls-unchained-g1-rfc9380",
};
const BEACON = { round: 7, randomness: "cd".repeat(32), signature: "ef".repeat(48) };

test("accepts application/json", async () => {
  respond(JSON.stringify(INFO), { "content-type": "application/json" });
  assert.deepEqual(await getChainInfo(), INFO);
});

test("accepts application/json with a charset parameter, in any case", async () => {
  respond(JSON.stringify(BEACON), { "content-type": "application/json; charset=utf-8" });
  assert.deepEqual(await getBeacon(7), BEACON);
  respond(JSON.stringify(BEACON), { "content-type": "Application/JSON;charset=UTF-8" });
  assert.deepEqual(await getBeacon(7), BEACON);
});

for (const [label, contentType] of [
  ["HTML", "text/html; charset=utf-8"],
  ["plain text", "text/plain"],
  ["text/json", "text/json"],
  ["a JSON-looking prefix", "application/jsonp"],
] as const) {
  test(`rejects a 200 response served as ${label}, for chain info and beacons`, async () => {
    respond("<html><body>blocked</body></html>", { "content-type": contentType });
    await assert.rejects(getChainInfo(), (err: unknown) => {
      assert.ok(err instanceof DrandResponseError);
      assert.equal(err.category, NON_JSON_RESPONSE);
      assert.equal(err.contentType, contentType);
      return true;
    });
    await assert.rejects(getBeacon("latest"), (err: unknown) => {
      assert.ok(err instanceof DrandResponseError);
      assert.equal(err.category, NON_JSON_RESPONSE);
      return true;
    });
  });
}

test("rejects a response with no content-type", async () => {
  globalThis.fetch = (async () => {
    const res = new Response(JSON.stringify(INFO), { status: 200 });
    res.headers.delete("content-type");
    return res;
  }) as typeof fetch;
  await assert.rejects(getChainInfo(), (err: unknown) => {
    assert.ok(err instanceof DrandResponseError);
    assert.equal(err.contentType, null);
    return true;
  });
});

test("uses the same category when a JSON content-type carries a broken body", async () => {
  respond("{not json", { "content-type": "application/json" });
  await assert.rejects(getBeacon(1), (err: unknown) => {
    assert.ok(err instanceof DrandResponseError);
    assert.equal(err.category, NON_JSON_RESPONSE);
    return true;
  });
});

test("a non-success status keeps its HTTP error", async () => {
  respond("<html></html>", { "content-type": "text/html" }, 503);
  await assert.rejects(getChainInfo(), /info HTTP 503/);
});
