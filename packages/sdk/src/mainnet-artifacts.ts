// SPDX-License-Identifier: MIT
/** Frozen mainnet deployment artifacts — read-only proof references. */
export const MAINNET_ARTIFACTS = {
  network: "Stellar Mainnet",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  rpcUrl: "https://rpc.ankr.com/stellar_soroban",
  contractId: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  wasmHash: "353915ad440965ea5f8d92fdb8d93cb2e309fb365e68e6762bca7fd6762b30c7",
  /** Native XLM SAC — escrow token for the mainnet smoke round. */
  escrowToken: "native XLM (SAC)",
  /** Stroops — 1 XLM bid, 5 XLM escrow (not testnet USDC demo amounts). */
  bidStroops: 10_000_000n,
  escrowStroops: 50_000_000n,
  bidXlm: "1",
  escrowXlm: "5",
  settledRoundId: 1,
  revealRound: 29_174_905,
  status: "Settled" as const,
  proofCommand: "pnpm mainnet:verify",
  deployCommand: "pnpm mainnet:deploy",
  settleCommand: "pnpm mainnet:settle",
  explorerContract:
    "https://stellar.expert/explorer/public/contract/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
} as const;

/**
 * Native XLM SAC address for a given network passphrase. The mainnet value is
 * committed in `mainnet-artifacts.json` so a drifted token config is a manifest
 * mismatch rather than a silently re-derived expectation.
 */
export const MAINNET_XLM_SAC_ID = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

/** Hard ceiling for optional mainnet micro runner (1 XLM escrow). */
export const MAINNET_MICRO_MAX_ESCROW = 10_000_000n;

/** Required env value before value-moving mainnet commands execute. */
export const MAINNET_CONFIRM_PHRASE = "SUB_ROSA_MAINNET";

/** Recommended minimum operator XLM for wasm upload (~30 XLM). */
export const MAINNET_DEPLOY_MIN_XLM_STROOPS = 300_000_000n;

/** Minimum XLM reserve for keeper/bidder fee coverage. */
export const MAINNET_MIN_FEE_RESERVE_STROOPS = 5_000_000n;

/**
 * Deployment identity a readiness check pins. Every one of these is compared
 * against the live chain, so a manifest edit that is not backed by a real
 * deployment fails the check instead of silently re-baselining it.
 */
export const DEPLOYMENT_FIELDS = [
  "contractId",
  "networkPassphrase",
  "wasmHash",
  "tokenContract",
] as const;

export type DeploymentField = (typeof DEPLOYMENT_FIELDS)[number];

/** Readiness check id per manifest field. Stable: it is the id operators grep. */
export const DEPLOYMENT_CHECK_IDS: Record<DeploymentField, string> = {
  contractId: "contract-id",
  networkPassphrase: "network-passphrase",
  wasmHash: "wasm-hash",
  tokenContract: "token-contract",
};

/** Human labels used in readiness output, keyed by manifest field. */
export const DEPLOYMENT_FIELD_LABELS: Record<DeploymentField, string> = {
  contractId: "Contract id",
  networkPassphrase: "Network passphrase",
  wasmHash: "Artifact wasm hash",
  tokenContract: "Escrow token contract",
};

/**
 * The committed artifact manifest. `mainnet-artifacts.json` is the file the repo
 * ships; `MAINNET_MANIFEST` is the in-module mirror of it for callers that
 * cannot touch the filesystem (bundlers, keepers). `parseMainnetManifest` proves
 * a loaded file has exactly this shape, and the SDK test suite fails if the two
 * ever drift.
 */
export interface MainnetManifest {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  contractId: string;
  wasmHash: string;
  tokenContract: string;
  escrowToken: string;
  settledRoundId: bigint;
  revealRound: bigint;
  bidStroops: bigint;
  escrowStroops: bigint;
  bidXlm: string;
  escrowXlm: string;
  status: "Settled";
}

/** Repo-relative path of the committed manifest. */
export const MAINNET_MANIFEST_PATH = "packages/sdk/mainnet-artifacts.json";
/** In-module mirror of `mainnet-artifacts.json`. */
export const MAINNET_MANIFEST: MainnetManifest = {
  network: MAINNET_ARTIFACTS.network,
  networkPassphrase: MAINNET_ARTIFACTS.networkPassphrase,
  rpcUrl: MAINNET_ARTIFACTS.rpcUrl,
  contractId: MAINNET_ARTIFACTS.contractId,
  wasmHash: MAINNET_ARTIFACTS.wasmHash,
  tokenContract: MAINNET_XLM_SAC_ID,
  escrowToken: MAINNET_ARTIFACTS.escrowToken,
  settledRoundId: BigInt(MAINNET_ARTIFACTS.settledRoundId),
  revealRound: BigInt(MAINNET_ARTIFACTS.revealRound),
  bidStroops: MAINNET_ARTIFACTS.bidStroops,
  escrowStroops: MAINNET_ARTIFACTS.escrowStroops,
  bidXlm: MAINNET_ARTIFACTS.bidXlm,
  escrowXlm: MAINNET_ARTIFACTS.escrowXlm,
  status: MAINNET_ARTIFACTS.status,
};

const WASM_HASH_RE = /^[0-9a-f]{64}$/i;

class ManifestFieldError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`mainnet manifest field ${field} is invalid: ${detail}`);
    this.name = "ManifestFieldError";
    this.field = field;
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ManifestFieldError("<root>", "expected a JSON object");
  }
  return raw as Record<string, unknown>;
}

function requiredString(
  raw: Record<string, unknown>,
  field: string,
): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestFieldError(field, "expected a non-empty string");
  }
  return value.trim();
}

function requiredHexHash(raw: Record<string, unknown>, field: string): string {
  const value = requiredString(raw, field);
  if (!WASM_HASH_RE.test(value)) {
    throw new ManifestFieldError(
      field,
      "expected 64 hexadecimal characters (the sha256 of the deployed wasm)",
    );
  }
  return value.toLowerCase();
}

function requiredSorobanId(
  raw: Record<string, unknown>,
  field: string,
): string {
  const value = requiredString(raw, field).toUpperCase();
  if (!/^C[A-Z2-7]{55}$/.test(value)) {
    throw new ManifestFieldError(
      field,
      "expected a Soroban contract id (C + 55 base32 characters)",
    );
  }
  return value;
}

function requiredPositiveBigInt(
  raw: Record<string, unknown>,
  field: string,
): bigint {
  const value = raw[field];
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new ManifestFieldError(field, "expected a positive integer");
    }
    return value;
  }
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text === "number") {
    if (!Number.isSafeInteger(text) || text <= 0) {
      throw new ManifestFieldError(
        field,
        "expected a positive integer or decimal string",
      );
    }
    return BigInt(text);
  }
  if (typeof text !== "string" || !/^\d+$/.test(text) || text === "0") {
    throw new ManifestFieldError(
      field,
      "expected a positive integer or decimal string (no signs, no exponents)",
    );
  }
  return BigInt(text);
}

const KNOWN_MANIFEST_FIELDS = [
  "network",
  "networkPassphrase",
  "rpcUrl",
  "contractId",
  "wasmHash",
  "tokenContract",
  "escrowToken",
  "settledRoundId",
  "revealRound",
  "bidStroops",
  "escrowStroops",
  "bidXlm",
  "escrowXlm",
  "status",
] as const;

/**
 * Validate a parsed manifest document. Unknown keys are rejected on purpose: a
 * typo'd deployment field would otherwise read as "no expectation recorded" and
 * leave a field uncompared.
 */
export function parseMainnetManifest(raw: unknown): MainnetManifest {
  const record = asRecord(raw);
  for (const key of Object.keys(record)) {
    if (!KNOWN_MANIFEST_FIELDS.includes(key as (typeof KNOWN_MANIFEST_FIELDS)[number])) {
      throw new ManifestFieldError(
        key,
        "unknown field — the manifest schema is closed so a typo cannot silently skip a comparison",
      );
    }
  }

  const rpcUrl = requiredString(record, "rpcUrl");
  if (!/^https:\/\//i.test(rpcUrl)) {
    throw new ManifestFieldError(
      "rpcUrl",
      "expected an https:// endpoint for a mainnet manifest",
    );
  }

  const status = requiredString(record, "status");
  if (status !== "Settled") {
    throw new ManifestFieldError(
      "status",
      `expected the proof round status to be "Settled", got ${JSON.stringify(status)}`,
    );
  }

  const bidStroops = requiredPositiveBigInt(record, "bidStroops");
  const escrowStroops = requiredPositiveBigInt(record, "escrowStroops");
  if (bidStroops > escrowStroops) {
    throw new ManifestFieldError(
      "bidStroops",
      "bid cannot exceed escrow in the committed manifest",
    );
  }

  return {
    network: requiredString(record, "network"),
    networkPassphrase: requiredString(record, "networkPassphrase"),
    rpcUrl,
    contractId: requiredSorobanId(record, "contractId"),
    wasmHash: requiredHexHash(record, "wasmHash"),
    tokenContract: requiredSorobanId(record, "tokenContract"),
    escrowToken: requiredString(record, "escrowToken"),
    settledRoundId: requiredPositiveBigInt(record, "settledRoundId"),
    revealRound: requiredPositiveBigInt(record, "revealRound"),
    bidStroops,
    escrowStroops,
    bidXlm: requiredString(record, "bidXlm"),
    escrowXlm: requiredString(record, "escrowXlm"),
    status: "Settled",
  };
}
