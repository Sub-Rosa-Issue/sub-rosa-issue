// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_LENGTH,
  DEFAULT_TRUNCATED_SUFFIX,
  truncateError,
  truncateStrings,
  type TruncateOptions,
} from "./truncate.js";

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

describe("truncateStrings", () => {
  it("keeps the first maxLength characters and marks the truncated value", () => {
    const result = truncateStrings("Hello, this is a very long string", { maxLength: 10 });
    assert.equal(result, "Hello, thi...");
    assert.equal(result.length, 13);
  });

  it("leaves strings at or below maxLength untouched", () => {
    assert.equal(truncateStrings("Short", { maxLength: 10 }), "Short");
    assert.equal(truncateStrings("ExactlyTen", { maxLength: 10 }), "ExactlyTen");
  });

  it("does not include the discarded remainder in the result", () => {
    const secretTail = "sk_live_do_not_log_me";
    const result = truncateStrings(`prefix-${secretTail}`, { maxLength: 6 });
    assert.equal(result, "prefix...");
    assert.ok(!result.includes("sk_live"));
  });

  it("uses the documented default limit and marker", () => {
    const long = "a".repeat(DEFAULT_MAX_LENGTH);
    assert.equal(truncateStrings(long), long);
    assert.equal(
      truncateStrings(`${long}b`),
      `${long}${DEFAULT_TRUNCATED_SUFFIX}`,
    );
  });

  it("applies the limit to nested object fields at every depth", () => {
    const input = {
      round: 42,
      message: "Hello world",
      nested: { deep: { deeper: "A very deep nested string that needs truncation" } },
    };
    const result = asRecord(truncateStrings(input, { maxLength: 10 }));
    assert.equal(result.round, 42);
    assert.equal(result.message, "Hello worl...");
    assert.equal(asRecord(asRecord(result.nested).deep).deeper, "A very dee...");
  });

  it("truncates strings inside arrays and nested arrays", () => {
    const input = ["short", "A very long string that should be truncated", ["Nested array value that is long"]];
    const result = asArray(truncateStrings(input, { maxLength: 10 }));
    assert.deepEqual(result[0], "short");
    assert.deepEqual(result[1], "A very lon...");
    assert.deepEqual(asArray(result[2])[0], "Nested arr...");
  });

  it("passes non-string values through unchanged", () => {
    const input = { nullValue: null, undefinedValue: undefined, count: 7, enabled: true, total: 10n };
    assert.deepEqual(truncateStrings(input, { maxLength: 1 }), input);
    assert.equal(truncateStrings(null, { maxLength: 1 }), null);
    assert.equal(truncateStrings(undefined, { maxLength: 1 }), undefined);
    assert.equal(truncateStrings(1234, { maxLength: 1 }), 1234);
  });

  it("handles empty strings", () => {
    assert.equal(truncateStrings("", { maxLength: 0 }), "");
  });

  it("supports a zero limit by keeping only the marker", () => {
    assert.equal(truncateStrings("anything", { maxLength: 0 }), "...");
  });

  it("honours a custom marker", () => {
    const options: TruncateOptions = { maxLength: 10, truncatedSuffix: "[TRUNCATED]" };
    assert.equal(truncateStrings("This is a test string", options), "This is a [TRUNCATED]");
  });

  it("rejects an invalid maxLength", () => {
    assert.throws(() => truncateStrings("x", { maxLength: -1 }), RangeError);
    assert.throws(() => truncateStrings("x", { maxLength: 1.5 }), RangeError);
    assert.throws(() => truncateStrings("x", { maxLength: Number.NaN }), RangeError);
  });
});

describe("truncateError", () => {
  it("truncates the message and keeps the error name", () => {
    const err = new Error("This is a test error message that is long enough to truncate");
    const result = truncateError(err, { maxLength: 20 });
    assert.equal(result.name, "Error");
    assert.equal(result.message, "This is a test error...");
  });

  it("preserves a custom error subclass name", () => {
    class DomainError extends Error {
      override name = "DomainError";
    }
    const result = truncateError(new DomainError("closed"), { maxLength: 20 });
    assert.equal(result.name, "DomainError");
    assert.equal(result.message, "closed");
  });

  it("copies own properties of every type", () => {
    const err = Object.assign(new Error("test message"), { code: "ERR_TEST", attempt: 2 });
    const result = truncateError(err, { maxLength: 100 });
    assert.equal(result.code, "ERR_TEST");
    assert.equal(result.attempt, 2);
  });

  it("truncates custom string properties", () => {
    const err = Object.assign(new Error("test"), { detail: "A custom detail string that is too long" });
    assert.equal(truncateError(err, { maxLength: 8 }).detail, "A custom...");
  });

  it("truncates nested properties and causes", () => {
    const cause = new Error("the underlying provider failure");
    const err = Object.assign(new Error("wrapper"), {
      nested: { deep: "A very deeply nested string that needs truncation" },
      cause,
    });
    const result = truncateError(err, { maxLength: 15 });
    assert.equal(asRecord(result.nested).deep, "A very deeply n...");
    const serializedCause = asRecord(nestedCause(result));
    assert.equal(serializedCause.name, "Error");
    assert.equal(serializedCause.message, "the underlying ...");
  });

  it("omits the stack", () => {
    const result = truncateError(new Error("boom"), { maxLength: 100 });
    assert.ok(!("stack" in result));
  });

  it("handles an empty message", () => {
    const result = truncateError(new Error(""), { maxLength: 10 });
    assert.equal(result.message, "");
    assert.equal(result.name, "Error");
  });

  it("handles errors inside arrays", () => {
    const result = truncateStrings([new Error("first"), new Error("second")], { maxLength: 100 });
    const [first, second] = asArray(result);
    assert.equal(asRecord(first).message, "first");
    assert.equal(asRecord(second).message, "second");
  });
});

function nestedCause(result: Record<string, unknown>): unknown {
  assert.ok("cause" in result, "cause must be preserved");
  return result.cause;
}
