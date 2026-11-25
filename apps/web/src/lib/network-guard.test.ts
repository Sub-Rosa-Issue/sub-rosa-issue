// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertDemoNetworkMatch,
  demoNetworkMismatch,
  DemoNetworkMismatchError,
} from "./network-guard";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

test("matching passphrases allow every demo action", () => {
  for (const action of ["commit", "reveal", "settle"] as const) {
    assert.doesNotThrow(() =>
      assertDemoNetworkMatch({ action, chainPassphrase: TESTNET, sdkPassphrase: TESTNET }),
    );
    assert.equal(
      demoNetworkMismatch({ chainPassphrase: PUBLIC, sdkPassphrase: PUBLIC }),
      null,
    );
  }
});

test("a mismatch blocks all three actions", () => {
  for (const action of ["commit", "reveal", "settle"] as const) {
    assert.throws(
      () => assertDemoNetworkMatch({ action, chainPassphrase: PUBLIC, sdkPassphrase: TESTNET }),
      (error: unknown) => {
        assert.ok(error instanceof DemoNetworkMismatchError);
        assert.equal(error.action, action);
        return true;
      },
    );
  }
});

test("the error names both networks and carries no secret or signed XDR", () => {
  assert.throws(
    () =>
      assertDemoNetworkMatch({ action: "commit", chainPassphrase: PUBLIC, sdkPassphrase: TESTNET }),
    (error: unknown) => {
      assert.ok(error instanceof DemoNetworkMismatchError);
      assert.equal(error.chainNetwork, "Public");
      assert.equal(error.sdkNetwork, "Testnet");
      assert.match(error.message, /Public/);
      assert.match(error.message, /Testnet/);
      // A Stellar secret key (S…, 56 chars) or a base64 signed envelope (AAAA…)
      // must never appear in the surfaced error.
      assert.doesNotMatch(error.message, /\bS[A-Z2-7]{55}\b/);
      assert.doesNotMatch(error.message, /AAAA/);
      assert.equal(Object.prototype.hasOwnProperty.call(error, "secretKey"), false);
      return true;
    },
  );
});

test("unknown passphrases are not blocked", () => {
  assert.doesNotThrow(() =>
    assertDemoNetworkMatch({ action: "settle", chainPassphrase: "", sdkPassphrase: TESTNET }),
  );
  assert.equal(
    demoNetworkMismatch({ chainPassphrase: "   ", sdkPassphrase: PUBLIC }),
    null,
  );
});

test("demoNetworkMismatch reports both network labels", () => {
  assert.deepEqual(
    demoNetworkMismatch({ chainPassphrase: PUBLIC, sdkPassphrase: TESTNET }),
    { chainNetwork: "Public", sdkNetwork: "Testnet" },
  );
});
