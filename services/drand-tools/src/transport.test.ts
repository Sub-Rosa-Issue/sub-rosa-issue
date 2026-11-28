// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDrandEndpointUrl, loadDrandConfig, QUICKNET_HASH } from "./quicknet.js";

test("requires HTTPS, with explicit loopback HTTP for development", () => {
  assert.equal(assertDrandEndpointUrl("https://drand.example").protocol, "https:");
  assert.throws(() => assertDrandEndpointUrl("http://127.0.0.1"), /requires HTTPS/);
  assert.throws(() => assertDrandEndpointUrl("http://drand.example", { allowLocalHttp: true }), /requires HTTPS/);
  for (const url of ["http://localhost:8123", "http://127.0.0.1:8123", "http://[::1]:8123"]) {
    assert.equal(assertDrandEndpointUrl(url, { allowLocalHttp: true }).protocol, "http:");
  }
});

test("redacts credentials and malformed endpoint input", () => {
  for (const value of ["https://user:private-value@drand.example", "bad-private-value"]) {
    assert.throws(
      () => assertDrandEndpointUrl(value),
      (error) => error instanceof Error && !error.message.includes("private-value"),
    );
  }
});

test("preserves the explicit local development override through configuration", () => {
  assert.deepEqual(loadDrandConfig({
    DRAND_CHAIN_HASH: QUICKNET_HASH,
    DRAND_API_URL: "http://127.0.0.1:8123/",
    DRAND_ALLOW_LOCAL_HTTP: "true",
  }), { expectedChainHash: QUICKNET_HASH, apiUrl: "http://127.0.0.1:8123", allowLocalHttp: true });
});
