// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { gateDemoActions } from "./config";
import { assertDemoActionAllowed, DemoActionBlockedError, demoActionAvailability } from "./demoActions";
import { ConfigBanner } from "../components/ConfigBanner";

const CONTRACT = "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX";
const OTHER = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const NETWORK = "Test SDF Network ; September 2015";
const SECRET = "SBSECRETSECRETSECRETSECRETSECRETSECRETSECRETSECRETSECRET";
const env = (overrides: Record<string, string | undefined> = {}) => ({
  VITE_RPC_URL: "https://rpc.example.com", VITE_NETWORK_PASSPHRASE: NETWORK, VITE_CONTRACT_ID: CONTRACT,
  VITE_SESSION_SECRET: SECRET, ...overrides,
});
const client = { contractId: CONTRACT, networkPassphrase: NETWORK };

test("matching config leaves commit, reveal and settle available", () => {
  const gate = gateDemoActions(client, env());
  assert.equal(gate.enabled, true);
  assert.deepEqual(demoActionAvailability(gate), { commit: true, reveal: true, settle: true });
  for (const action of ["commit", "reveal", "settle"] as const) assertDemoActionAllowed(action, gate);
  assert.equal(renderToStaticMarkup(<ConfigBanner gate={gate} />), "");
});

test("a different contract id disables commit, reveal and settle", () => {
  const gate = gateDemoActions({ ...client, contractId: OTHER }, env());
  assert.equal(gate.enabled, false);
  assert.deepEqual(demoActionAvailability(gate), { commit: false, reveal: false, settle: false });
  for (const action of ["commit", "reveal", "settle"] as const) {
    assert.throws(() => assertDemoActionAllowed(action, gate), DemoActionBlockedError);
  }
  assert.match(renderToStaticMarkup(<ConfigBanner gate={gate} />), /VITE_CONTRACT_ID does not match/);
});

test("a different network passphrase disables the actions", () => {
  const gate = gateDemoActions({ ...client, networkPassphrase: "Public Global Stellar Network ; September 2015" }, env());
  assert.equal(gate.enabled, false);
  assert.ok(gate.issues.some((i) => i.key === "VITE_NETWORK_PASSPHRASE"));
});

test("a missing public contract id disables the actions instead of falling back", () => {
  for (const value of [undefined, "", "   "]) {
    const gate = gateDemoActions(client, env({ VITE_CONTRACT_ID: value }));
    assert.equal(gate.enabled, false);
    assert.deepEqual(demoActionAvailability(gate), { commit: false, reveal: false, settle: false });
  }
  assert.equal(gateDemoActions(null, env()).enabled, false);
});

test("the banner text does not contain a secret or config values", () => {
  const gate = gateDemoActions({ contractId: SECRET, networkPassphrase: SECRET }, env());
  const html = renderToStaticMarkup(<ConfigBanner gate={gate} />);
  assert.match(html, /Demo actions disabled/);
  assert.ok(!html.includes(SECRET));
  assert.ok(!html.includes(CONTRACT));
  assert.doesNotMatch(html, /Dismiss/);
});
