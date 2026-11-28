// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROUND_CONTRACT_ERRORS,
  ROUND_CONTRACT_ERRORS_BY_NAME,
  getRoundContractError,
  isRoundContractErrorRetryable,
  diffContractErrorMapping,
  SubRosaClientConfigError,
  SubRosaPreflightError,
  SubRosaSubmitError,
  SubRosaTransactionError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaTimeoutError,
} from "./errors.js";
import { Errors as RoundBindingsErrors } from "@sub-rosa/round-bindings";
import { SubRosaClient } from "./client.js";
import { createFakeTime } from "@sub-rosa/time";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../");

describe("SubRosaClientConfigError", () => {
  it("sets name and message", () => {
    const err = new SubRosaClientConfigError("bad config");
    assert.equal(err.name, "SubRosaClientConfigError");
    assert.equal(err.message, "bad config");
  });

  it("preserves cause", () => {
    const cause = new Error("root");
    const err = new SubRosaClientConfigError("msg", { cause });
    assert.equal(err.cause, cause);
  });
});

describe("SubRosaNetworkMismatchError", () => {
  it("exposes conflicting network details", () => {
    const err = new SubRosaNetworkMismatchError({
      contractId: "C123",
      configuredPassphrase: "testnet",
      rpcPassphrase: "public",
      rpcUrl: "https://rpc.example",
      reason: "passphrase",
    });
    assert.equal(err.name, "SubRosaNetworkMismatchError");
    assert.equal(err.contractId, "C123");
    assert.equal(err.configuredPassphrase, "testnet");
    assert.equal(err.rpcPassphrase, "public");
    assert.equal(err.reason, "passphrase");
    assert.match(err.message, /same deployment/);
  });
});

describe("SubRosaSubmitError", () => {
  it("sets name and message", () => {
    const err = new SubRosaSubmitError("submit failed");
    assert.equal(err.name, "SubRosaSubmitError");
    assert.equal(err.message, "submit failed");
  });

  it("preserves cause", () => {
    const cause = new Error("network err");
    const err = new SubRosaSubmitError("submit failed", { cause });
    assert.equal(err.cause, cause);
  });
});

describe("SubRosaTransactionError", () => {
  it("sets name, hash, status, and message", () => {
    const err = new SubRosaTransactionError("abc123", "FAILED");
    assert.equal(err.name, "SubRosaTransactionError");
    assert.equal(err.hash, "abc123");
    assert.equal(err.status, "FAILED");
    assert.equal(err.message, "transaction abc123 ended with status FAILED");
  });

  it("preserves cause", () => {
    const cause = new Error("root");
    const err = new SubRosaTransactionError("abc", "FAILED", { cause });
    assert.equal(err.cause, cause);
  });
});

describe("SubRosaMissingReturnValueError", () => {
  it("sets name, hash, and message", () => {
    const err = new SubRosaMissingReturnValueError("abc123");
    assert.equal(err.name, "SubRosaMissingReturnValueError");
    assert.equal(err.hash, "abc123");
    assert.equal(
      err.message,
      "transaction abc123 succeeded without a return value",
    );
  });
});

describe("SubRosaTimeoutError", () => {
  it("sets all properties", () => {
    const err = new SubRosaTimeoutError({
      hash: "0xdeadbeef",
      submitter: "mock-submitter",
      lastStatus: "NOT_FOUND",
      timeoutMs: 30_000,
      pollIntervalMs: 1_000,
    });
    assert.equal(err.name, "SubRosaTimeoutError");
    assert.equal(err.hash, "0xdeadbeef");
    assert.equal(err.submitter, "mock-submitter");
    assert.equal(err.lastStatus, "NOT_FOUND");
    assert.equal(err.timeoutMs, 30_000);
    assert.equal(err.pollIntervalMs, 1_000);
    assert(
      err.message.includes("0xdeadbeef"),
      "message should contain hash",
    );
    assert(
      err.message.includes("mock-submitter"),
      "message should contain submitter name",
    );
    assert(
      err.message.includes("NOT_FOUND"),
      "message should contain last status",
    );
  });

  it("allows zero or non-standard timing values", () => {
    const err = new SubRosaTimeoutError({
      hash: "x",
      submitter: "s",
      lastStatus: "FAILED",
      timeoutMs: 0,
      pollIntervalMs: 0,
    });
    assert.equal(err.timeoutMs, 0);
    assert.equal(err.pollIntervalMs, 0);
  });
});

// -------------------------------------------------------------------------
// Config validation
// -------------------------------------------------------------------------

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CDAZ5AJPVCJ6R3BQUPYISBSWV77HZ52T7YFWZGTVEEEFW5FVHZAK2JIM",
};

describe("SubRosaClientConfig validation", () => {
  it("rejects confirmTimeout < 1000", () => {
    assert.throws(
      () => new SubRosaClient({ ...BASE_CONFIG, confirmTimeout: 999 }),
      SubRosaClientConfigError,
    );
  });

  it("rejects non-finite confirmTimeout values", () => {
    for (const confirmTimeout of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new SubRosaClient({ ...BASE_CONFIG, confirmTimeout }),
        SubRosaClientConfigError,
      );
    }
  });

  it("accepts confirmTimeout = 1000", () => {
    assert.doesNotThrow(
      () => new SubRosaClient({ ...BASE_CONFIG, confirmTimeout: 1000 }),
    );
  });

  it("rejects pollInterval < 100", () => {
    assert.throws(
      () => new SubRosaClient({ ...BASE_CONFIG, pollInterval: 99 }),
      SubRosaClientConfigError,
    );
  });

  it("rejects non-finite pollInterval values", () => {
    for (const pollInterval of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new SubRosaClient({ ...BASE_CONFIG, pollInterval }),
        SubRosaClientConfigError,
      );
    }
  });

  it("accepts pollInterval = 100", () => {
    assert.doesNotThrow(
      () => new SubRosaClient({ ...BASE_CONFIG, pollInterval: 100 }),
    );
  });

  it("uses default values when not configured", () => {
    const client = new SubRosaClient(BASE_CONFIG);
    assert.ok(client instanceof SubRosaClient);
  });
});

// -------------------------------------------------------------------------
// Custom polling settings with injected sleep
// -------------------------------------------------------------------------

describe("custom polling settings with injected sleep", () => {
  it("accepts injected fake scheduler without invoking it during construction", () => {
    const { scheduler } = createFakeTime();

    const client = new SubRosaClient({
      ...BASE_CONFIG,
      confirmTimeout: 10_000,
      pollInterval: 200,
      time: { scheduler },
    });
    assert.ok(client instanceof SubRosaClient);
  });

  it("deprecated _sleep override still works for compatibility", () => {
    let sleepCalls = 0;
    const fakeSleep = async (_ms: number) => {
      sleepCalls += 1;
    };

    const client = new SubRosaClient({
      ...BASE_CONFIG,
      confirmTimeout: 10_000,
      pollInterval: 200,
      _sleep: fakeSleep,
    });
    assert.ok(client instanceof SubRosaClient);
    assert.equal(sleepCalls, 0);
  });

  it("timeout error carries timing context that matches config", () => {
    const timeoutMs = 10_000;
    const pollIntervalMs = 500;
    const err = new SubRosaTimeoutError({
      hash: "0xdeadbeef",
      submitter: "mock-submitter",
      lastStatus: "NOT_FOUND",
      timeoutMs,
      pollIntervalMs,
    });
    assert.equal(err.timeoutMs, timeoutMs);
    assert.equal(err.pollIntervalMs, pollIntervalMs);
  });

  it("can classify failures by error type without parsing messages", () => {
    const configErr = new SubRosaClientConfigError("bad config");
    const submitErr = new SubRosaSubmitError("submit failed");
    const txErr = new SubRosaTransactionError("h", "FAILED");
    const missingErr = new SubRosaMissingReturnValueError("h");
    const timeoutErr = new SubRosaTimeoutError({
      hash: "h",
      submitter: "s",
      lastStatus: "NOT_FOUND",
      timeoutMs: 1000,
      pollIntervalMs: 100,
    });

    assert.equal(configErr instanceof SubRosaClientConfigError, true);
    assert.equal(submitErr instanceof SubRosaSubmitError, true);
    assert.equal(txErr instanceof SubRosaTransactionError, true);
    assert.equal(missingErr instanceof SubRosaMissingReturnValueError, true);
    assert.equal(timeoutErr instanceof SubRosaTimeoutError, true);

    assert.equal(configErr instanceof Error, true);
    assert.equal(submitErr instanceof Error, true);
    assert.equal(txErr instanceof Error, true);
    assert.equal(missingErr instanceof Error, true);
    assert.equal(timeoutErr instanceof Error, true);
  });
});

// -------------------------------------------------------------------------
// Round contract error mapping & retryable classification
// -------------------------------------------------------------------------

function parseErrorsMdContent(content: string) {
  const variants: { name: string; code: number }[] = [];
  const re = /^\|\s*(\d+)\s*\|\s*`(\w+)`\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    variants.push({ name: match[2], code: Number(match[1]) });
  }
  return variants;
}

function parseTypesRsContent(content: string) {
  const enumMatch = content.match(
    /#\[contracterror\][\s\S]*?pub enum Error \{([\s\S]*?)\n\}/,
  );
  if (!enumMatch) {
    throw new Error("Could not find `pub enum Error` in types.rs");
  }
  const variants: { name: string; code: number }[] = [];
  for (const line of enumMatch[1].split("\n")) {
    const match = line.match(/^\s+(\w+)\s*=\s*(\d+),?\s*(?:\/\/.*)?$/);
    if (match) {
      variants.push({ name: match[1], code: Number(match[2]) });
    }
  }
  return variants;
}

function parseErrorPathsRsRegistry(content: string) {
  const regMatch = content.match(
    /const ERROR_PATH_REGISTRY:\s*&\[\(Error,\s*&'static str\)\]\s*=\s*&\[([\s\S]*?)\];/,
  );
  if (!regMatch) {
    throw new Error("Could not find ERROR_PATH_REGISTRY in error_paths.rs");
  }
  const variants: string[] = [];
  for (const line of regMatch[1].split("\n")) {
    const match = line.match(/Error::(\w+)/);
    if (match) {
      variants.push(match[1]);
    }
  }
  return variants;
}

describe("ROUND_CONTRACT_ERRORS mapping coverage", () => {
  it("covers every error variant in contracts/round/ERRORS.md", () => {
    const errorsMdPath = resolve(REPO_ROOT, "contracts/round/ERRORS.md");
    const content = readFileSync(errorsMdPath, "utf-8");
    const docErrors = parseErrorsMdContent(content);

    assert.ok(docErrors.length >= 27, "ERRORS.md must contain at least 27 error rows");
    const failures = diffContractErrorMapping(docErrors);
    assert.deepEqual(failures, [], "Every documented contract error must match ROUND_CONTRACT_ERRORS");
  });

  it("covers every error variant in contracts/round/src/types.rs", () => {
    const typesRsPath = resolve(REPO_ROOT, "contracts/round/src/types.rs");
    const content = readFileSync(typesRsPath, "utf-8");
    const typesErrors = parseTypesRsContent(content);

    assert.ok(typesErrors.length >= 27, "types.rs must contain at least 27 error variants");
    const failures = diffContractErrorMapping(typesErrors);
    assert.deepEqual(failures, [], "types.rs enum Error must match ROUND_CONTRACT_ERRORS");
  });

  it("covers every variant tested in contracts/round/src/error_paths.rs", () => {
    const errorPathsPath = resolve(REPO_ROOT, "contracts/round/src/error_paths.rs");
    const content = readFileSync(errorPathsPath, "utf-8");
    const registryVariants = parseErrorPathsRsRegistry(content);

    assert.ok(
      registryVariants.length >= 27,
      "ERROR_PATH_REGISTRY must contain at least 27 error variants",
    );
    for (const name of registryVariants) {
      const mapped = ROUND_CONTRACT_ERRORS_BY_NAME[name];
      assert.ok(
        mapped !== undefined,
        `Variant '${name}' from error_paths.rs must exist in ROUND_CONTRACT_ERRORS_BY_NAME`,
      );
    }
  });

  it("covers every error in generated @sub-rosa/round-bindings", () => {
    const bindingEntries = Object.entries(RoundBindingsErrors).map(
      ([codeStr, info]) => ({
        code: Number(codeStr),
        name: info.message,
      }),
    );
    const failures = diffContractErrorMapping(bindingEntries);
    assert.deepEqual(failures, [], "Generated bindings must match SDK error mapping");
  });

  it("fails when a fixture error without a mapping is present", () => {
    const fixtureWithUnmapped = [
      ...Object.values(ROUND_CONTRACT_ERRORS).map((e) => ({
        code: e.code,
        name: e.name,
      })),
      { code: 99, name: "UnmappedContractError" },
    ];
    const failures = diffContractErrorMapping(fixtureWithUnmapped);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /UnmappedContractError/);
    assert.match(failures[0], /not mapped/);
  });

  it("fails when a mapped SDK error is missing from the contract list", () => {
    const incompleteList = Object.values(ROUND_CONTRACT_ERRORS)
      .filter((e) => e.name !== "NotInitialized")
      .map((e) => ({ code: e.code, name: e.name }));
    const failures = diffContractErrorMapping(incompleteList);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /NotInitialized/);
    assert.match(failures[0], /missing from contract errors list/);
  });
});

describe("isRoundContractErrorRetryable classification", () => {
  it("marks transient and lifecycle timing conditions as retryable", () => {
    const retryableErrors = [
      "CommitNotClosed",
      "RevealNotOpen",
      "RevealStillOpen",
      "NotCleared",
      "NotVoidable",
    ];

    for (const name of retryableErrors) {
      const spec = getRoundContractError(name);
      assert.ok(spec, `Expected spec for ${name}`);
      assert.equal(
        spec.retryable,
        true,
        `${name} (#${spec.code}) must be marked retryable: true`,
      );
      assert.equal(
        isRoundContractErrorRetryable(name),
        true,
        `isRoundContractErrorRetryable('${name}') must return true`,
      );
      assert.equal(
        isRoundContractErrorRetryable(spec.code),
        true,
        `isRoundContractErrorRetryable(${spec.code}) must return true`,
      );
    }
  });

  it("marks permanent contract failures as non-retryable", () => {
    const permanentErrors = [
      "NotInitialized",
      "AlreadyInitialized",
      "RoundNotFound",
      "BidNotFound",
      "CommitClosed",
      "CommitDeadlineAfterReveal",
      "RevealAlreadyOpen",
      "RevealWindowClosed",
      "AlreadyCleared",
      "AlreadySettled",
      "RoundVoided",
      "WrongStatus",
      "InvalidDrandSignature",
      "HashMismatch",
      "AlreadyRevealed",
      "PayloadTooLarge",
      "InvalidAmount",
      "BidExceedsEscrow",
      "DeadlineInPast",
      "NoValidBids",
      "RoundFull",
      "InvalidLimit",
    ];

    for (const name of permanentErrors) {
      const spec = getRoundContractError(name);
      assert.ok(spec, `Expected spec for ${name}`);
      assert.equal(
        spec.retryable,
        false,
        `${name} (#${spec.code}) must be marked non-retryable: false`,
      );
      assert.equal(
        isRoundContractErrorRetryable(name),
        false,
        `isRoundContractErrorRetryable('${name}') must return false`,
      );
      assert.equal(
        isRoundContractErrorRetryable(spec.code),
        false,
        `isRoundContractErrorRetryable(${spec.code}) must return false`,
      );
    }
  });

  it("treats unknown errors as non-retryable", () => {
    assert.equal(isRoundContractErrorRetryable("UnknownTrap"), false);
    assert.equal(isRoundContractErrorRetryable(999), false);
    assert.equal(isRoundContractErrorRetryable(0), false);
    assert.equal(isRoundContractErrorRetryable(undefined), false);
    assert.equal(isRoundContractErrorRetryable(null), false);
    assert.equal(getRoundContractError("UnknownTrap"), undefined);
    assert.equal(getRoundContractError(999), undefined);
  });
});

describe("SubRosaPreflightError with contract error retryable integration", () => {
  it("automatically infers retryable: true for retryable contract error codes and messages", () => {
    const errByCode = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "settle",
      message: "Contract rejected call: NotCleared",
      contractErrorCode: 17,
      contractErrorMessage: "NotCleared",
    });
    assert.equal(errByCode.retryable, true);

    const errByNameOnly = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "clear",
      message: "Contract rejected call: RevealStillOpen",
      contractErrorMessage: "RevealStillOpen",
    });
    assert.equal(errByNameOnly.retryable, true);
  });

  it("automatically infers retryable: false for permanent contract errors", () => {
    const errSettled = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "settle",
      message: "Contract rejected call: AlreadySettled",
      contractErrorCode: 19,
      contractErrorMessage: "AlreadySettled",
    });
    assert.equal(errSettled.retryable, false);

    const errHashMismatch = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "reveal",
      message: "Contract rejected call: HashMismatch",
      contractErrorCode: 31,
      contractErrorMessage: "HashMismatch",
    });
    assert.equal(errHashMismatch.retryable, false);
  });

  it("defaults unknown contract errors and other preflight kinds to retryable: false", () => {
    const unknownContractErr = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "commit",
      message: "Contract rejected call: CustomUnknownTrap",
      contractErrorCode: 888,
      contractErrorMessage: "CustomUnknownTrap",
    });
    assert.equal(unknownContractErr.retryable, false);

    const simErr = new SubRosaPreflightError({
      kind: "simulation_error",
      operation: "commit",
      message: "Simulation failed",
    });
    assert.equal(simErr.retryable, false);
  });

  it("respects explicit retryable overrides when supplied", () => {
    const overrideTrue = new SubRosaPreflightError({
      kind: "simulation_error",
      operation: "commit",
      message: "Transient simulation failure",
      retryable: true,
    });
    assert.equal(overrideTrue.retryable, true);

    const overrideFalse = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "settle",
      message: "Contract rejected call: NotCleared",
      contractErrorCode: 17,
      contractErrorMessage: "NotCleared",
      retryable: false,
    });
    assert.equal(overrideFalse.retryable, false);
  });
});

