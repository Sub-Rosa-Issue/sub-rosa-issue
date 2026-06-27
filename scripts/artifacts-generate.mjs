#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  PATHS,
  SOURCE_COMMAND,
  buildManifest,
  buildWasm,
  computeSourceHash,
  computeSpecHash,
  generateBindingsToTemp,
  installBindingsFromTemp,
  sha256File,
  writeManifest,
} from "./artifacts-lib.mjs";

console.log("Building Round contract WASM…");
buildWasm();

const wasmHash = sha256File(PATHS.wasm);
console.log(`WASM hash: ${wasmHash}`);

console.log("Generating TypeScript bindings…");
generateBindingsToTemp();
installBindingsFromTemp();

const bindingsContent = readFileSync(PATHS.bindings, "utf8");
const specHash = computeSpecHash(bindingsContent);
const sourceHash = computeSourceHash();

const manifest = buildManifest({ wasmHash, specHash, sourceHash });
writeManifest(manifest);

console.log("Updated artifact manifest:");
console.log(`  ${PATHS.manifest}`);
console.log(`  spec hash:    ${specHash}`);
console.log(`  source hash:  ${sourceHash}`);
console.log("");
console.log("Commit these files together:");
console.log("  - packages/round-bindings/src/index.ts");
console.log("  - deployments/artifact-manifest.json");
