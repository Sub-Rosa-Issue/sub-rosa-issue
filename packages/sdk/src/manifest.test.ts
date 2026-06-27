import { verifyManifest, type ArtifactManifest } from "./manifest.js";

const VALID: ArtifactManifest = {
  version: "1.0.0",
  wasmHash: "a".repeat(64),
  contractId: "CTEST",
  networkPassphrase: "Test SDF Network ; September 2015",
  deployedAt: "2026-06-27T00:00:00Z",
  bindingsRef: "v1.0.0",
};

describe("verifyManifest", () => {
  it("accepts a valid manifest", () => {
    expect(() => verifyManifest(VALID)).not.toThrow();
  });

  it("throws on missing wasmHash", () => {
    expect(() => verifyManifest({ ...VALID, wasmHash: "" })).toThrow("wasmHash");
  });

  it("throws on invalid wasmHash format", () => {
    expect(() => verifyManifest({ ...VALID, wasmHash: "notHex" })).toThrow("64-character hex");
  });

  it("throws on unknown network passphrase", () => {
    expect(() => verifyManifest({ ...VALID, networkPassphrase: "Unknown" })).toThrow("unknown");
  });

  it("throws on missing contractId", () => {
    expect(() => verifyManifest({ ...VALID, contractId: "" })).toThrow("contractId");
  });

  it("accepts mainnet passphrase", () => {
    expect(() => verifyManifest({
      ...VALID,
      networkPassphrase: "Public Global Stellar Network ; September 2015"
    })).not.toThrow();
  });
});
