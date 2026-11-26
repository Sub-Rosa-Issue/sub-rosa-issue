// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DRAND_API_URL,
  assertDrandEndpointUrl,
  drandApiUrl,
} from "./quicknet.js";

test("defaults to the HTTPS public Drand API", () => {
  assert.equal(DEFAULT_DRAND_API_URL, "https://api.drand.sh");
  assert.equal(assertDrandEndpointUrl(DEFAULT_DRAND_API_URL).protocol, "https:");
  assert.equal(assertDrandEndpointUrl().hostname, "api.drand.sh");
});

test("accepts an HTTPS remote endpoint", () => {
  const url = assertDrandEndpointUrl("https://drand.example.test/");
  assert.equal(url.origin, "https://drand.example.test");
});

test("rejects a plaintext remote endpoint", () => {
  assert.throws(
    () => assertDrandEndpointUrl("http://api.drand.sh"),
    /DRAND_API_URL must use https:\/\//,
  );
});

test("rejects plaintext loopback unless local HTTP is explicitly allowed", () => {
  assert.throws(
    () => assertDrandEndpointUrl("http://localhost:8080"),
    /DRAND_API_URL must use https:\/\//,
  );
  assert.equal(
    assertDrandEndpointUrl("http://localhost:8080", { allowLocalHttp: true }).port,
    "8080",
  );
});

test("local HTTP opt-in does not cover non-loopback hosts", () => {
  assert.throws(
    () => assertDrandEndpointUrl("http://10.0.0.5:8080", { allowLocalHttp: true }),
    /DRAND_API_URL must use https:\/\//,
  );
});

test("rejects empty, malformed, and non-HTTP endpoints", () => {
  assert.throws(() => assertDrandEndpointUrl(""), /non-empty/);
  assert.throws(() => assertDrandEndpointUrl("not a url"), /valid http\(s\) URL/);
  assert.throws(() => assertDrandEndpointUrl("ftp://api.drand.sh"), /must use https:\/\//);
});

test("drandApiUrl reads and normalises DRAND_API_URL", () => {
  const previous = process.env.DRAND_API_URL;
  try {
    delete process.env.DRAND_API_URL;
    assert.equal(drandApiUrl(), DEFAULT_DRAND_API_URL);

    process.env.DRAND_API_URL = "https://drand.example.test///";
    assert.equal(drandApiUrl(), "https://drand.example.test");

    process.env.DRAND_API_URL = "http://drand.example.test";
    assert.throws(() => drandApiUrl(), /must use https:\/\//);
  } finally {
    if (previous === undefined) delete process.env.DRAND_API_URL;
    else process.env.DRAND_API_URL = previous;
  }
});
