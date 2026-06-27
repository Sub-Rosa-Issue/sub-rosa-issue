// Versioned contract artifact manifest.
// Ties WASM hash, contract ID, generated binding version, and network together
// so integrators can verify all components belong to the same deployment.

export interface ArtifactManifest {
  /** Semantic version of this manifest entry. */
  version: string;
  /** SHA-256 hex digest of the deployed WASM. */
  wasmHash: string;
  /** Deployed contract ID on the given network. */
  contractId: string;
  /** Network passphrase the contract is deployed on. */
  networkPassphrase: string;
  /** Timestamp of the deployment (ISO-8601). */
  deployedAt: string;
  /** Short git ref or tag of the bindings used. */
  bindingsRef: string;
}

/** Well-known network passphrases. */
export const NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
} as const;

/**
 * Verify that a manifest entry is internally consistent.
 * Throws if network passphrase does not match a known value
 * or if required fields are missing.
 */
export function verifyManifest(manifest: ArtifactManifest): void {
  const required: (keyof ArtifactManifest)[] = [
    "version", "wasmHash", "contractId", "networkPassphrase",
    "deployedAt", "bindingsRef",
  ];
  for (const field of required) {
    if (!manifest[field]) {
      throw new Error(`ArtifactManifest: missing required field '${field}'`);
    }
  }
  const knownPassphrases = Object.values(NETWORK_PASSPHRASES);
  if (!knownPassphrases.includes(manifest.networkPassphrase as any)) {
    throw new Error(
      `ArtifactManifest: unknown networkPassphrase '${manifest.networkPassphrase}'. ` +
      `Known values: ${knownPassphrases.join(", ")}`
    );
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.wasmHash)) {
    throw new Error(
      `ArtifactManifest: wasmHash must be a 64-character hex string, got '${manifest.wasmHash}'`
    );
  }
}

/**
 * Load and verify a manifest from a JSON file path.
 * Returns the validated manifest.
 */
export async function loadManifest(filePath: string): Promise<ArtifactManifest> {
  const fs = await import("fs/promises");
  const raw = await fs.readFile(filePath, "utf-8");
  const manifest: ArtifactManifest = JSON.parse(raw);
  verifyManifest(manifest);
  return manifest;
}
