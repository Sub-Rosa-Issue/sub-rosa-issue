import { truncateStrings, truncateError, type TruncateOptions } from "./truncate.js";
import { describe, it, expect } from "vitest";

describe("truncateStrings", () => {
  it("should truncate strings longer than maxLength", () => {
    const input = "Hello, this is a very long string that should be truncated";
    const result = truncateStrings(input, { maxLength: 10 });
    expect(result).toBe("Hello, this...");
  });

  it("should not truncate strings shorter than maxLength", () => {
    const input = "Short";
    const result = truncateStrings(input, { maxLength: 10 });
    expect(result).toBe("Short");
  });

  it("should truncate nested strings in objects", () => {
    const input = { message: "Hello world", nested: { deep: "A very deep nested string that needs truncation" } };
    const result = truncateStrings(input, { maxLength: 10 });
    expect(result.message).toBe("Hello world");
    expect(result.nested.deep).toMatch(/A very de.../);
  });

  it("should truncate strings in arrays", () => {
    const input = ["short", "A very long string that should be truncated", "another short one"];
    const result = truncateStrings(input, { maxLength: 10 });
    expect(result[0]).toBe("short");
    expect(result[1]).toMatch(/Long stri.../);
    expect(result[2]).toBe("another short one");
  });

  it("should handle null and undefined", () => {
    const result = truncateStrings(null as any, { maxLength: 10 });
    expect(result).toBeNull();
    const result2 = truncateStrings(undefined as any, { maxLength: 10 });
    expect(result2).toBeUndefined();
  });

  it("should handle empty strings", () => {
    const result = truncateStrings("", { maxLength: 10 });
    expect(result).toBe("");
  });

  it("should use custom maxLength and truncatedSuffix", () => {
    const input = "This is a test string that is quite long";
    const result = truncateStrings(input, { maxLength: 10, truncatedSuffix: "[TRUNCATED]" });
    expect(result).toBe("This is a [TRUNCATED]");
  });
});

describe("truncateError", () => {
  it("should truncate error message and preserve name", () => {
    const err = new Error("This is a test error message that is quite long to trigger truncation");
    const result = truncateError(err, { maxLength: 20 });
    expect(result.name).toBe("Error");
    expect(result.message).toMatch(/This is a test/);
    expect((result.message as string).length).toBeLessThanOrEqual(20);
  });

  it("should copy over custom error properties", () => {
    const err = new Error("test message");
    err.code = "ERR_TEST";
    err.customField = "some value";
    const result = truncateError(err, { maxLength: 10 });
    expect(result.code).toBe("ERR_TEST");
    expect(result.customField).toBe("some value");
  });

  it("should truncate nested properties in error", () => {
    // @ts-expect-error - testing with non-standard error structure
    const err = new Error("test");
    err.nested = { deep: "A very deeply nested string that definitely needs truncation" };
    const result = truncateError(err, { maxLength: 15 });
    expect((result.nested as any).deep).toMatch(/A very de.../);
  });

  it("should handle empty error", () => {
    const err = new Error("");
    const result = truncateError(err, { maxLength: 10 });
    expect(result.message).toBe("");
    expect(result.name).toBe("Error");
  });
});