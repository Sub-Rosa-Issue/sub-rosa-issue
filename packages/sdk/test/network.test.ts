import { describe, it, expect } from "vitest";
import { SubRosaNetworkMismatchError } from "../src/errors.js";
import {
  assertNetworkConfig,
  KNOWN_NETWORKS,
} from "../src/network.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const CUSTOM_PASSPHRASE = "Custom Local Network ; June 2026";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const MAINNET_RPC = "https://rpc.ankr.com/stellar_soroban";
const CUSTOM_RPC = "http://localhost:8000";

describe("assertNetworkConfig", () => {
  it("passes for valid testnet config (passphrase + RPC match)", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: TESTNET_RPC,
      }),
    ).not.toThrow();
  });

  it("passes for valid mainnet config (passphrase + RPC match)", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: MAINNET_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      }),
    ).not.toThrow();
  });

  it("passes for custom passphrase with testnet RPC (bypass)", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: CUSTOM_PASSPHRASE,
        rpcUrl: TESTNET_RPC,
      }),
    ).not.toThrow();
  });

  it("passes for custom passphrase with mainnet RPC (bypass)", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: CUSTOM_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      }),
    ).not.toThrow();
  });

  it("passes for custom passphrase with custom RPC (bypass)", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: CUSTOM_PASSPHRASE,
        rpcUrl: CUSTOM_RPC,
      }),
    ).not.toThrow();
  });

  it("rejects testnet passphrase with mainnet RPC", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      }),
    ).toThrow(SubRosaNetworkMismatchError);
  });

  it("rejects mainnet passphrase with testnet RPC", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: MAINNET_PASSPHRASE,
        rpcUrl: TESTNET_RPC,
      }),
    ).toThrow(SubRosaNetworkMismatchError);
  });

  it("rejects empty passphrase", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: "",
        rpcUrl: TESTNET_RPC,
      }),
    ).toThrow(SubRosaNetworkMismatchError);
  });

  it("error message includes conflicting passphrase and RPC URL", () => {
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      }),
    ).toThrowError(/Test SDF Network/);
    expect(() =>
      assertNetworkConfig({
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      }),
    ).toThrowError(/rpc\.ankr\.com/);
  });

  it("error carries typed passphrase and rpcUrl fields", () => {
    try {
      assertNetworkConfig({
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: MAINNET_RPC,
      });
      expect.fail("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(SubRosaNetworkMismatchError);
      expect((err as SubRosaNetworkMismatchError).networkPassphrase).toBe(TESTNET_PASSPHRASE);
      expect((err as SubRosaNetworkMismatchError).rpcUrl).toBe(MAINNET_RPC);
    }
  });
});

describe("KNOWN_NETWORKS", () => {
  it("exports testnet entry", () => {
    const testnet = KNOWN_NETWORKS.find((n) => n.label === "Stellar Testnet");
    expect(testnet).toBeDefined();
    expect(testnet!.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(testnet!.rpcUrlPattern).toBeInstanceOf(RegExp);
  });

  it("exports mainnet entry", () => {
    const mainnet = KNOWN_NETWORKS.find((n) => n.label === "Stellar Mainnet");
    expect(mainnet).toBeDefined();
    expect(mainnet!.networkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(mainnet!.rpcUrlPattern).toBeInstanceOf(RegExp);
  });

  it("testnet pattern matches testnet RPC", () => {
    const testnet = KNOWN_NETWORKS.find((n) => n.label === "Stellar Testnet")!;
    expect(testnet.rpcUrlPattern.test(TESTNET_RPC)).toBe(true);
    expect(testnet.rpcUrlPattern.test(MAINNET_RPC)).toBe(false);
  });

  it("mainnet pattern matches mainnet RPC", () => {
    const mainnet = KNOWN_NETWORKS.find((n) => n.label === "Stellar Mainnet")!;
    expect(mainnet.rpcUrlPattern.test(MAINNET_RPC)).toBe(true);
    expect(mainnet.rpcUrlPattern.test(TESTNET_RPC)).toBe(false);
  });
});
