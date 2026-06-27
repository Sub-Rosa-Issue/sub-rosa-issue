#!/usr/bin/env node
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  PATHS,
  SOURCE_COMMAND,
  buildWasm,
  computeSourceHash,
  computeSpecHash,
  generateBindingsToTemp,
  readManifest,
  sha256File,
} from "./artifacts-lib.mjs";

const failures = [];

let manifest;
try {
  manifest = readManifest();
} catch {
  console.error("✗ Binding consistency check failed.\n");
  console.error("  Missing deployments/artifact-manifest.json.");
  console.error(`  Fix: ${SOURCE_COMMAND}`);
  process.exit(1);
}

console.log("Building Round contract WASM from current source…");
buildWasm();

const builtWasmHash = sha256File(PATHS.wasm);
const currentSourceHash = computeSourceHash();
const committedBindings = readFileSync(PATHS.bindings, "utf8");
const committedSpecHash = computeSpecHash(committedBindings);

compare("WASM hash", manifest.build?.wasmHash, builtWasmHash);
compare("ContractSpec hash", manifest.build?.specHash, committedSpecHash);
compare("Contract source hash", manifest.contract?.sourceHash, currentSourceHash);

console.log("Regenerating bindings to verify they match committed output…");
generateBindingsToTemp();
const regeneratedBindings = readFileSync(
  join(PATHS.tmpBindings, "src/index.ts"),
  "utf8",
);
const regeneratedSpecHash = computeSpecHash(regeneratedBindings);

if (regeneratedSpecHash !== committedSpecHash) {
  failures.push({
    label: "Generated bindings",
    expected: "match committed packages/round-bindings/src/index.ts",
    actual: "differ — bindings are stale for the current WASM build",
    detail: `committed spec hash: ${committedSpecHash}\n    regenerated spec hash: ${regeneratedSpecHash}`,
  });
}

rmSync(PATHS.tmpBindings, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("\n✗ Binding consistency check failed.\n");
  for (const failure of failures) {
    console.error(`  ${failure.label} mismatch:`);
    console.error(`    manifest/expected: ${failure.expected}`);
    console.error(`    current:           ${failure.actual}`);
    if (failure.detail) {
      console.error(`    ${failure.detail}`);
    }
    console.error("");
  }

  console.error(`Fix: ${SOURCE_COMMAND}`);
  console.error("Then commit:");
  console.error("  - packages/round-bindings/src/index.ts");
  console.error("  - deployments/artifact-manifest.json");
  process.exit(1);
}

console.log("✓ Bindings, WASM hash, and artifact manifest are consistent.");

function compare(label, expected, actual) {
  if (expected !== actual) {
    failures.push({
      label,
      expected,
      actual,
    });
  }
}
