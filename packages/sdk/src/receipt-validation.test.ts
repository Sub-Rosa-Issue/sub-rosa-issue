import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SubRosaReceiptValidationError } from "./errors.js";
import { parseReceipt, serializeReceipt, validateReceipt } from "./receipt.js";
import { verifyReceipt } from "./verify.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(DIR, "..", "fixtures", "golden.json");

function loadGoldenReceipt() {
  return parseReceipt(readFileSync(FIXTURE_PATH, "utf-8"));
}

describe("SubRosaReceiptValidationError", () => {
  it("sets name, message, and field", () => {
    const err = new SubRosaReceiptValidationError("bad version", "version");
    assert.equal(err.name, "SubRosaReceiptValidationError");
    assert.equal(err.message, "bad version");
    assert.equal(err.field, "version");
  });
});

describe("validateReceipt malformed input", () => {
  it("rejects unsupported schema version", () => {
    const receipt = loadGoldenReceipt();
    receipt.version = 99 as typeof receipt.version;
    assert.throws(
      () => validateReceipt(receipt),
      (err: unknown) => {
        assert.ok(err instanceof SubRosaReceiptValidationError);
        assert.equal(err.field, "version");
        return true;
      },
    );
  });

  it("rejects networkFingerprint that does not match network", () => {
    const receipt = loadGoldenReceipt();
    receipt.networkFingerprint = "00".repeat(32);
    assert.throws(
      () => validateReceipt(receipt),
      (err: unknown) => {
        assert.ok(err instanceof SubRosaReceiptValidationError);
        assert.equal(err.field, "networkFingerprint");
        return true;
      },
    );
  });

  it("rejects missing bid entry for a listed bidder", () => {
    const receipt = loadGoldenReceipt();
    const missing = receipt.bidders[0];
    delete receipt.bids[missing];
    assert.throws(
      () => validateReceipt(receipt),
      (err: unknown) => {
        assert.ok(err instanceof SubRosaReceiptValidationError);
        assert.match(err.message, /missing bid entry/);
        return true;
      },
    );
  });

  it("rejects invalid receipt JSON", () => {
    assert.throws(
      () => parseReceipt("{not-json"),
      (err: unknown) => {
        assert.ok(err instanceof SubRosaReceiptValidationError);
        assert.equal(err.message, "receipt JSON is invalid");
        return true;
      },
    );
  });
});

describe("receipt round-trip with verifyReceipt", () => {
  it("serializeReceipt → parseReceipt → verifyReceipt succeeds on golden fixture", () => {
    const receipt = loadGoldenReceipt();
    const roundTripped = parseReceipt(serializeReceipt(receipt));
    const result = verifyReceipt(roundTripped);
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  });
});
