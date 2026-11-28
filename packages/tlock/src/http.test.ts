// Copyright (c) 2026 Sub Rosa contributors
// Boundary tests for the bounded Quicknet HTTP layer. No network: every test
// supplies a fake `fetch`, so the exact byte ceiling can be exercised offline.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DrandResponseTooLargeError,
  MAX_DRAND_RESPONSE_BYTES,
  fetchDrandJson,
  type FetchLike,
} from "./http.js";
import { chainInfo, quicknet } from "./quicknet.js";

/** A JSON document whose UTF-8 encoding is exactly `bytes` long. */
function jsonOfSize(bytes: number): string {
  const empty = JSON.stringify({ data: "" });
  return JSON.stringify({ data: "x".repeat(bytes - empty.length) });
}

function fakeFetch(response: Response | (() => Response)): FetchLike {
  return async () => (typeof response === "function" ? response() : response);
}

test("fetchDrandJson accepts a body exactly at the byte ceiling", async () => {
  const body = jsonOfSize(MAX_DRAND_RESPONSE_BYTES);
  assert.equal(new TextEncoder().encode(body).byteLength, MAX_DRAND_RESPONSE_BYTES);

  const parsed = await fetchDrandJson<{ data: string }>(
    "https://api.drand.sh/test",
    fakeFetch(new Response(body)),
  );
  assert.equal(parsed.data.length, MAX_DRAND_RESPONSE_BYTES - JSON.stringify({ data: "" }).length);
});

test("fetchDrandJson rejects a body one byte over the ceiling", async () => {
  const body = jsonOfSize(MAX_DRAND_RESPONSE_BYTES + 1);

  await assert.rejects(
    fetchDrandJson("https://api.drand.sh/test", fakeFetch(new Response(body))),
    (error: unknown) => {
      assert.ok(error instanceof DrandResponseTooLargeError);
      assert.match(error.message, new RegExp(`${MAX_DRAND_RESPONSE_BYTES}-byte limit`));
      return true;
    },
  );
});

test("fetchDrandJson aborts on an oversized Content-Length before reading a body", async () => {
  const response = new Response(null, {
    headers: { "content-length": String(MAX_DRAND_RESPONSE_BYTES + 1) },
  });

  await assert.rejects(
    fetchDrandJson("https://api.drand.sh/test", fakeFetch(response)),
    DrandResponseTooLargeError,
  );
});

test("fetchDrandJson stops a chunked body before JSON parsing", async () => {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("x".repeat(8 * 1024));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 16; i += 1) controller.enqueue(chunk);
      controller.close();
    },
  });

  await assert.rejects(
    fetchDrandJson("https://api.drand.sh/test", fakeFetch(new Response(stream))),
    (error: unknown) => {
      assert.ok(error instanceof DrandResponseTooLargeError);
      assert.doesNotMatch(error.message, /JSON/i, "parsing must not be attempted");
      return true;
    },
  );
});

test("fetchDrandJson preserves non-2xx handling", async () => {
  await assert.rejects(
    fetchDrandJson(
      "https://api.drand.sh/test",
      fakeFetch(new Response("nope", { status: 503 })),
    ),
    /HTTP 503/,
  );
});

test("quicknet bounds chain-info responses too", async () => {
  const client = quicknet(
    fakeFetch(new Response(jsonOfSize(MAX_DRAND_RESPONSE_BYTES + 1))),
  );

  await assert.rejects(chainInfo(client), DrandResponseTooLargeError);
});

test("quicknet keeps chain-info validation after the size check", async () => {
  const malformed = JSON.stringify({ period: 3 });
  const client = quicknet(fakeFetch(new Response(malformed)));

  await assert.rejects(chainInfo(client), /malformed drand chain-info/);
});

test("quicknet requests the beacon for the requested round", async () => {
  const urls: string[] = [];
  const client = quicknet(async (input) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({ round: 42, randomness: "00", signature: "00" }),
    );
  });

  await client.get(42);
  assert.deepEqual(urls, [
    "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/42",
  ]);
});
