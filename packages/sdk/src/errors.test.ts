import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SubRosaClientConfigError,
  SubRosaSubmitError,
  SubRosaTransactionError,
  SubRosaMissingReturnValueError,
  SubRosaTimeoutError,
} from "./errors.js";
import { SubRosaClient } from "./client.js";

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
  contractId: "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ",
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
  it("accepts injected sleep without invoking it during construction", () => {
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
