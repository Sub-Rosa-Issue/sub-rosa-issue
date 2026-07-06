import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeReceipt, parseReceipt } from "./receipt.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(DIR, "..", "fixtures", "golden.json");

test("Receipt serialization determinism: Golden fixture test", () => {
  const rawFixture = readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = parseReceipt(rawFixture);
  const serialized1 = serializeReceipt(parsed);
  const serialized2 = serializeReceipt(parsed);
  assert.equal(serialized1, serialized2);
});

test("Receipt serialization determinism: Parse/serialize round trip", () => {
  const rawFixture = readFileSync(FIXTURE_PATH, "utf-8");
  
  const parsed1 = parseReceipt(rawFixture);
  const serialized1 = serializeReceipt(parsed1);
  
  const parsed2 = parseReceipt(serialized1);
  const serialized2 = serializeReceipt(parsed2);
  
  assert.equal(serialized1, serialized2);
});

test("Receipt serialization determinism: Canonical key ordering", () => {
  const rawFixture = readFileSync(FIXTURE_PATH, "utf-8");
  const parsedGolden = parseReceipt(rawFixture);

  // Deeply reverse the keys of an object to verify that the canonical key ordering
  // of serializeReceipt produces the identical canonical JSON regardless of insertion order.
  function reverseKeys(obj: any): any {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(reverseKeys);
    }
    const keys = Object.keys(obj).reverse();
    const newObj: any = {};
    for (const key of keys) {
      newObj[key] = reverseKeys(obj[key]);
    }
    return newObj;
  }

  const reorderedReceipt = reverseKeys(parsedGolden);
  const serializedGolden = serializeReceipt(parsedGolden);
  const serializedReordered = serializeReceipt(reorderedReceipt);

  assert.equal(serializedReordered, serializedGolden);
});
