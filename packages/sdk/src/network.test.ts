import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SubRosaNetworkMismatchError } from "./errors.js";
import { MAINNET_ARTIFACTS } from "./mainnet-artifacts.js";
import {
  STELLAR_PUBLIC_PASSPHRASE,
  STELLAR_TESTNET_PASSPHRASE,
  validateNetworkPassphrase,
} from "./network.js";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const MAINNET_RPC = MAINNET_ARTIFACTS.rpcUrl;
const CUSTOM_RPC = "http://localhost:8000";
const CUSTOM_PASSPHRASE = "Local Sandbox ; September 2025";

// ── validateNetworkPassphrase (standalone, fully offline) ──────────────

describe("validateNetworkPassphrase", () => {
  it("allows a valid testnet config", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(STELLAR_TESTNET_PASSPHRASE, TESTNET_RPC),
    );
  });

  it("allows a valid testnet config with any non-mainnet RPC", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(
        STELLAR_TESTNET_PASSPHRASE,
        "https://rpc.example.com",
      ),
    );
  });

  it("allows a valid public config (mainnet passphrase + mainnet RPC)", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(STELLAR_PUBLIC_PASSPHRASE, MAINNET_RPC),
    );
  });

  it("rejects testnet passphrase with mainnet RPC", () => {
    assert.throws(
      () =>
        validateNetworkPassphrase(STELLAR_TESTNET_PASSPHRASE, MAINNET_RPC),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.match(
          error.message,
          /testnet passphrase|mainnet/,
        );
        return true;
      },
    );
  });

  it("rejects mainnet passphrase with testnet RPC", () => {
    assert.throws(
      () =>
        validateNetworkPassphrase(STELLAR_PUBLIC_PASSPHRASE, TESTNET_RPC),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.match(
          error.message,
          /Public Network passphrase/,
        );
        return true;
      },
    );
  });

  it("rejects mainnet passphrase with any non-mainnet RPC", () => {
    assert.throws(
      () =>
        validateNetworkPassphrase(
          STELLAR_PUBLIC_PASSPHRASE,
          "https://rpc.example.com",
        ),
      SubRosaNetworkMismatchError,
    );
  });

  it("rejects an empty passphrase", () => {
    assert.throws(
      () => validateNetworkPassphrase("", TESTNET_RPC),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.equal(error.message, "networkPassphrase is required");
        return true;
      },
    );
  });

  it("allows a custom/local passphrase (bypass)", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(CUSTOM_PASSPHRASE, CUSTOM_RPC),
    );
  });

  it("allows a custom/local passphrase with mainnet RPC (bypass)", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(CUSTOM_PASSPHRASE, MAINNET_RPC),
    );
  });

  it("allows a custom/local passphrase with testnet RPC (bypass)", () => {
    assert.doesNotThrow(() =>
      validateNetworkPassphrase(CUSTOM_PASSPHRASE, TESTNET_RPC),
    );
  });

  it("error message tells callers which config values conflict", () => {
    try {
      validateNetworkPassphrase(STELLAR_TESTNET_PASSPHRASE, MAINNET_RPC);
      assert.fail("expected error");
    } catch (error: unknown) {
      assert.ok(error instanceof SubRosaNetworkMismatchError);
      assert.match(error.message, /Test SDF Network/);
      assert.match(error.message, /rpc.ankr.com/);
      assert.match(error.message, /Public Global Stellar Network/);
    }
  });
});
