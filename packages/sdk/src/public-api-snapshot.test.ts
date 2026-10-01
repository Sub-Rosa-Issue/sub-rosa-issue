// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The committed public-surface snapshot. Any change to the SDK's exports must
// update this list in the same change; the snapshot is the gate.
const EXPECTED_EXPORTS = [
  "SubRosaPaginationError",
  "ASSET_FIXTURES",
  "AssetConfigError",
  "DEPLOYMENT_CHECK_IDS",
  "DEPLOYMENT_FIELDS",
  "DEPLOYMENT_FIELD_LABELS",
  "ACTIVE_ROUND_STATUSES",
  "ERROR_ROUND_STATUSES",
  "ESCROW_PAGE_SIZE",
  "ESCROW_MAX_BIDDERS",
  "KeeperStatusClient",
  "KeeperStatusTimeoutError",
  "MAINNET_ARTIFACTS",
  "MAINNET_MANIFEST",
  "MAINNET_MANIFEST_PATH",
  "MAINNET_XLM_SAC_ID",
  "MAINNET_CONFIRM_PHRASE",
  "MAINNET_DEPLOY_MIN_XLM_STROOPS",
  "MAINNET_MICRO_MAX_ESCROW",
  "MAINNET_MIN_FEE_RESERVE_STROOPS",
  "MAX_AUDITOR_BLOB_BYTES",
  "MAX_CIPHERTEXT_BYTES",
  "RECEIPT_EVENT_ERROR_CODES",
  "RECEIPT_VERSION",
  "ROUND_CONTRACT_ERRORS",
  "ROUND_CONTRACT_ERRORS_BY_NAME",
  "RoundContract",
  "RoundErrors",
  "StatusApiError",
  "StatusJsonParseError",
  "SubRosaAssetValidationError",
  "SubRosaClient",
  "SubRosaClientConfigError",
  "SubRosaDeploymentMismatchError",
  "SubRosaManifestError",
  "SubRosaMissingReturnValueError",
  "SubRosaNetworkMismatchError",
  "SubRosaNetworkPassphraseMismatchError",
  "SubRosaPreflightError",
  "SubRosaSessionMismatchError",
  "SubRosaSubmitError",
  "SubRosaTimeoutError",
  "SubRosaTransactionError",
  "TERMINAL_ROUND_STATUSES",
  "assertDeploymentMatches",
  "assertMainnetConfirmed",
  "assertMicroAmounts",
  "assertReadinessForExecute",
  "assertSealedBid",
  "classifyRoundStatus",
  "contractErrorCode",
  "createOzChannelsSubmitter",
  "createOzChannelsSubmitterFromEnv",
  "compareDeployment",
  "createSacBalanceReader",
  "defaultMainnetReadinessInput",
  "deploymentChecks",
  "evaluatePreflight",
  "evaluateEscrowConservation",
  "fetchContractWasmHash",
  "fetchKeeperStatus",
  "fixtureDeployment",
  "fixtureReader",
  "formatReadinessReport",
  "getRoundContractError",
  "hasBlockingFailures",
  "isActiveRoundStatus",
  "isErrorRoundStatus",
  "isEscrowConserved",
  "isKeeperRoundActive",
  "isKeeperRoundSettlementPending",
  "isKeeperRoundTerminal",
  "isRoundContractErrorRetryable",
  "isTerminalRoundStatus",
  "nativeXlmSacId",
  "parseMainnetManifest",
  "parseMainnetReadinessFixture",
  "readLiveDeployment",
  "networkFingerprint",
  "networkPassphrasesMatch",
  "normalizeRoundId",
  "normalizeSorobanContractId",
  "parseMicroStroops",
  "parseReceipt",
  "proveEscrowConservationFromPages",
  "redactReceipt",
  "redactUrlUserinfo",
  "roundStatusLabel",
  "runMainnetReadiness",
  "summarizeDeploymentValue",
  "serializeReceipt",
  "tryDecodeBase64",
  "tryDecodeHex",
  "validateAssetConfig",
  "validateAssetConfigs",
  "validateEncryptedBlob",
  "validateContractNetwork",
  "validateSealedBid",
  "verifyReceipt",
  "verifyReceiptEvents",
  "verifySettledRoundProof",
  "ROUND_EVENT_LIFECYCLE_ORDER",
  "ROUND_EVENT_PHASE_BY_NAME",
  "ROUND_EVENT_PHASE_RANK",
  "ROUND_PHASES",
  "ROUND_PHASE_LABELS",
  "diffContractErrorMapping",
  "expectedRoundEventSequence",
  "isRoundPhase",
  "roundPhaseLabel",
  "validatePasskeySession",
];

// A symbol that mentions a secret, seed, or raw keypair must never be exported
// unless it is explicitly approved below. The pattern is deliberately broad: a
// false positive is fixed by an allowlist entry reviewed in the same PR.
const SECRET_SYMBOL_PATTERN =
  /(secret|seed|keypair|key_pair|privatekey|private_key|privkey|mnemonic|rawkey|raw_key|\bsk\b)/i;

// Names that match SECRET_SYMBOL_PATTERN but are deliberately part of the public
// surface. Adding an entry here is a security decision and must be justified in
// review; an empty set means "no secret-bearing symbol may be exported".
const ALLOWLISTED_SECRET_SYMBOLS = new Set<string>([]);

const INDEX_SOURCE = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

/**
 * Parse `index.ts` (the package entry) into the identifiers it exports,
 * separated into runtime **values** and **types**.
 *
 * This is a static read on purpose: the snapshot must not execute the SDK (and
 * therefore must not construct any network client) just to check its surface.
 */
function extractExports(source: string): { values: string[]; types: string[] } {
  const values = new Set<string>();
  const types = new Set<string>();

  const addEntry = (raw: string, forceType: boolean): void => {
    const entry = raw.trim();
    if (!entry) return;
    const isType = forceType || /^type\s+/.test(entry);
    const stripped = entry.replace(/^type\s+/, "");
    const local = stripped.split(/\s+as\s+/).pop()?.trim() ?? "";
    if (!local) return;
    (isType ? types : values).add(local);
  };

  // export { A, type B, C as D } from "..."
  const blockRe = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/g;
  for (const match of source.matchAll(blockRe)) {
    const forceType = Boolean(match[1]);
    for (const part of match[2].split(",")) addEntry(part, forceType);
  }

  // export type X = ... / export interface X / export class X / export function X / export const X
  const declRe =
    /export\s+(?:abstract\s+)?(type|interface|class|function|const|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declRe)) {
    const kind = match[1];
    const name = match[2];
    if (kind === "class") {
      values.add(name);
      types.add(name);
    } else if (kind === "type" || kind === "interface") {
      types.add(name);
    } else {
      values.add(name);
    }
  }

  return { values: [...values].sort(), types: [...types].sort() };
}

/** Extra exports (present but not in the snapshot) and missing ones. */
function diffExports(
  actual: string[],
  expected: string[],
): { extra: string[]; missing: string[] } {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    extra: [...actualSet].filter((name) => !expectedSet.has(name)).sort(),
    missing: [...expectedSet].filter((name) => !actualSet.has(name)).sort(),
  };
}

/**
 * Names that look like they carry a secret/seed/keypair and are not explicitly
 * allowlisted. Being present in the snapshot does not exempt a name: the
 * allowlist is a separate, reviewed decision.
 */
function findSecretBearingSymbols(names: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const name of names) {
    if (SECRET_SYMBOL_PATTERN.test(name) && !ALLOWLISTED_SECRET_SYMBOLS.has(name)) {
      found.add(name);
    }
  }
  return [...found].sort();
}

describe("SDK public API snapshot", () => {
  it("matches the committed snapshot of exported values", () => {
    const { extra, missing } = diffExports(
      extractExports(INDEX_SOURCE).values,
      EXPECTED_EXPORTS,
    );
    assert.deepEqual(
      { extra, missing },
      { extra: [], missing: [] },
      "index.ts exports drifted from the committed snapshot",
    );
  });

  it("exports no secret-bearing value symbol", () => {
    assert.deepEqual(findSecretBearingSymbols(extractExports(INDEX_SOURCE).values), []);
  });

  it("exports no secret-bearing type symbol", () => {
    assert.deepEqual(findSecretBearingSymbols(extractExports(INDEX_SOURCE).types), []);
  });

  it("does not import the SDK runtime (no network client constructed)", () => {
    // The snapshot is derived from source text only; this assertion documents
    // the guarantee and would fail if someone reintroduced a runtime import.
    const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.doesNotMatch(testSource, /from\s+["']\.\/index\.js["']/);
  });
});

describe("SDK public API snapshot guard", () => {
  it("fails on an extra export", () => {
    const { extra, missing } = diffExports(["A", "B", "Extra"], ["A", "B"]);
    assert.deepEqual(extra, ["Extra"]);
    assert.deepEqual(missing, []);
  });

  it("fails on a missing export", () => {
    const { extra, missing } = diffExports(["A"], ["A", "B"]);
    assert.deepEqual(extra, []);
    assert.deepEqual(missing, ["B"]);
  });

  it("flags an export that accepts a secret key, even when it is in the snapshot", () => {
    const snapshotWithLeak = [...EXPECTED_EXPORTS, "createSubmitterFromSecretSeed"];
    assert.deepEqual(findSecretBearingSymbols(snapshotWithLeak), [
      "createSubmitterFromSecretSeed",
    ]);
  });

  it("flags raw keypair and private-key exports", () => {
    assert.deepEqual(findSecretBearingSymbols(["getRawKeypair", "readPrivateKey"]), [
      "getRawKeypair",
      "readPrivateKey",
    ]);
  });

  it("does not flag ordinary public helpers", () => {
    assert.deepEqual(
      findSecretBearingSymbols(["redactReceipt", "SubRosaClient", "normalizeRoundId"]),
      [],
    );
  });

  it("separates value exports from type exports", () => {
    const source = [
      'export { Foo, type Bar, Baz as Qux } from "./m.js";',
      'export type { Zed } from "./m.js";',
      "export interface Iface {}",
      "export class Klass {}",
    ].join("\n");
    const { values, types } = extractExports(source);
    assert.deepEqual(values, ["Foo", "Klass", "Qux"]);
    assert.deepEqual(types, ["Bar", "Iface", "Klass", "Zed"]);
  });

  it("detects a secret-bearing type export in source", () => {
    const source = [
      'export type { PublicKey, SecretSeed } from "./keys.js";',
      "export interface ApiClient {}",
    ].join("\n");
    const { types } = extractExports(source);
    assert.ok(types.includes("SecretSeed"));
    assert.deepEqual(findSecretBearingSymbols(types), ["SecretSeed"]);
  });

  it("allows a secret-ish name only when it is explicitly allowlisted", () => {
    // The allowlist is exported behaviour, not magic: assert it is empty today
    // so the guard is effectively "no secret-bearing symbol may ship".
    assert.equal(ALLOWLISTED_SECRET_SYMBOLS.size, 0);
  });
});
