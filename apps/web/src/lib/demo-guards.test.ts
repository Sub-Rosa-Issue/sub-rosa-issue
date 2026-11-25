// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDemoNetworkAllowed,
  networkDisplayName,
  NetworkMismatchError,
  passphrasesReferToSameNetwork,
} from "./demo-guards";

const PUBLIC = "Public Global Stellar Network ; September 2015";
const TESTNET = "Test SDF Network ; September 2015";
const FUTURENET = "Test SDF Future Network ; October 2022";

test("passphrasesReferToSameNetwork accepts two testnet passphrases", () => {
  assert.equal(passphrasesReferToSameNetwork(TESTNET, TESTNET), true);
});

test("passphrasesReferToSameNetwork rejects testnet vs public", () => {
  assert.equal(passphrasesReferToSameNetwork(TESTNET, PUBLIC), false);
});

test("passphrasesReferToSameNetwork rejects an unknown wallet network", () => {
  assert.equal(passphrasesReferToSameNetwork(TESTNET, "Local Network ; January 2030"), false);
});

test("passphrasesReferToSameNetwork accepts identical unknown passphrases", () => {
  assert.equal(
    passphrasesReferToSameNetwork("Local Network ; January 2030", "Local Network ; January 2030"),
    true,
  );
});

test("networkDisplayName maps the well-known passphrases", () => {
  assert.equal(networkDisplayName(PUBLIC), "Public");
  assert.equal(networkDisplayName(TESTNET), "Testnet");
  assert.equal(networkDisplayName(FUTURENET), "Futurenet");
  assert.equal(networkDisplayName("whatever"), "Unknown network");
});

test("assertDemoNetworkAllowed resolves when networks agree", () => {
  assert.doesNotThrow(() => assertDemoNetworkAllowed(TESTNET, TESTNET));
});

test("assertDemoNetworkAllowed throws NetworkMismatchError naming both networks", () => {
  assert.throws(() => assertDemoNetworkAllowed(TESTNET, PUBLIC), (err: unknown) => {
    assert.ok(err instanceof NetworkMismatchError);
    assert.match(err.message, /Testnet/);
    assert.match(err.message, /Public/);
    assert.match(err.message, /Network mismatch/);
    return true;
  });
});

test("mismatch error messages stay public-safe", () => {
  try {
    assertDemoNetworkAllowed(TESTNET, PUBLIC);
    assert.fail("expected NetworkMismatchError");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /secret/i);
    assert.doesNotMatch(err.message, /xdr/i);
    assert.doesNotMatch(err.message, /S[A-Z0-9]{55}/);
    assert.equal(err.message.includes("AAAA"), false);
  }
});
