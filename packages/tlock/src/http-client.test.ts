// Copyright (c) 2026 Sub Rosa contributors
// Tests for HTTP client content-type validation.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateContentType,
  ValidatingHttpChainClient,
  createValidatingQuicknetClient,
} from "./http-client.js";

test("validateContentType accepts application/json", () => {
  assert.doesNotThrow(() => validateContentType("application/json"));
});

test("validateContentType accepts application/json with charset", () => {
  assert.doesNotThrow(() => validateContentType("application/json; charset=utf-8"));
  assert.doesNotThrow(() => validateContentType("application/json;charset=utf-8"));
  assert.doesNotThrow(() => validateContentType("APPLICATION/JSON; CHARSET=UTF-8"));
});

test("validateContentType rejects text/html", () => {
  assert.throws(
    () => validateContentType("text/html"),
    /Unexpected Content-Type: expected application\/json, got text\/html/,
  );
});

test("validateContentType rejects text/plain", () => {
  assert.throws(
    () => validateContentType("text/plain"),
    /Unexpected Content-Type: expected application\/json, got text\/plain/,
  );
});

test("validateContentType rejects application/xml", () => {
  assert.throws(
    () => validateContentType("application/xml"),
    /Unexpected Content-Type: expected application\/json, got application\/xml/,
  );
});

test("validateContentType rejects missing content-type", () => {
  assert.throws(
    () => validateContentType(null),
    /Missing Content-Type header in Drand response/,
  );
});

test("validateContentType rejects empty content-type", () => {
  assert.throws(
    () => validateContentType(""),
    /Unexpected Content-Type: expected application\/json, got /,
  );
});

test("createValidatingQuicknetClient returns a ChainClient", () => {
  const client = createValidatingQuicknetClient();
  assert.ok(typeof client.get === "function");
  assert.ok(typeof client.latest === "function");
  assert.ok(typeof client.chain === "function");
});

test("ValidatingHttpChainClient validates content-type before parsing", async () => {
  // This test would require a mock server. We test the validator directly above.
  // The client integration is tested by the quicknet tests using the real network.
  const client = createValidatingQuicknetClient();
  assert.ok(client instanceof ValidatingHttpChainClient);
});