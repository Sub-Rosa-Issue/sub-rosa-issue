#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
/**
 * Verify `rust-toolchain.toml` pins an explicit `X.Y.Z` Rust version (never a
 * moving channel like `stable`) and that every `dtolnay/rust-toolchain` step in
 * `.github/workflows/*.yml` plus `CONTRIBUTING.md` and `docs/CI.md` stay aligned.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";
import { normalizeError } from "../packages/logging/src/errors.cjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const logger = createLogger("scripts.check-rust-toolchain");

export const PINNED_RUST_VERSION = "1.91.0";
export const CONTRACT_WORKFLOWS = ["contract.yml", "bindings-check.yml"];

/**
 * Parse `channel = "..."` from `rust-toolchain.toml` and require an explicit semver.
 * @param {string} tomlText
 * @returns {string}
 */
export function parseRustToolchainChannel(tomlText) {
  const match = tomlText.match(/^\s*channel\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('rust-toolchain.toml is missing a `channel = "..."` entry');
  }
  const channel = match[1].trim();
  if (!/^\d+\.\d+\.\d+$/.test(channel)) {
    throw new Error(
      `rust-toolchain.toml channel must be an explicit X.Y.Z version (found "${channel}")`,
    );
  }
  return channel;
}

/**
 * Inspect workflow YAML files for `dtolnay/rust-toolchain` steps.
 * @param {string} workflowDir
 * @param {(path: string) => string} [readFile]
 * @param {(path: string) => string[]} [listDir]
 */
export function findWorkflowRustToolchains(
  workflowDir,
  readFile = (p) => readFileSync(p, "utf8"),
  listDir = (p) => readdirSync(p),
) {
  const entries = [];
  for (const name of listDir(workflowDir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFile(join(workflowDir, name));
    const stepRegex =
      /uses:\s*dtolnay\/rust-toolchain@([^\s#]+)(?:[\s\S]{0,160}?toolchain:\s*["']?([^"'\s#]+)["']?)?/g;
    for (const match of text.matchAll(stepRegex)) {
      const refVersion = match[1];
      const inputToolchain = match[2] ?? refVersion;
      entries.push({
        file: name,
        refVersion,
        toolchain: inputToolchain,
      });
    }
  }
  return entries;
}

/**
 * Validate repository-wide Rust toolchain pinning.
 * @param {string} [repoRoot]
 */
export function validateRustToolchainAlignment(repoRoot = root) {
  const errors = [];
  let channel = "";

  try {
    const toml = readFileSync(join(repoRoot, "rust-toolchain.toml"), "utf8");
    channel = parseRustToolchainChannel(toml);
    if (channel !== PINNED_RUST_VERSION) {
      errors.push(
        `rust-toolchain.toml channel "${channel}" does not match expected ${PINNED_RUST_VERSION}`,
      );
    }
  } catch (err) {
    errors.push(normalizeError(err).message);
  }

  const entries = findWorkflowRustToolchains(join(repoRoot, ".github/workflows"));
  for (const wf of CONTRACT_WORKFLOWS) {
    if (!entries.some((e) => e.file === wf)) {
      errors.push(`Expected ${wf} to configure dtolnay/rust-toolchain`);
    }
  }

  for (const entry of entries) {
    if (entry.refVersion === "stable" || entry.toolchain === "stable") {
      errors.push(
        `${entry.file} uses moving "stable" Rust toolchain reference instead of pinned ${channel || PINNED_RUST_VERSION}`,
      );
    }
    if (channel && (entry.refVersion !== channel || entry.toolchain !== channel)) {
      errors.push(
        `${entry.file} pins Rust toolchain (${entry.refVersion} / ${entry.toolchain}) instead of ${channel}`,
      );
    }
  }

  const contributing = readFileSync(join(repoRoot, "CONTRIBUTING.md"), "utf8");
  if (channel && !contributing.includes(channel)) {
    errors.push(`CONTRIBUTING.md must document pinned Rust version ${channel}`);
  }

  const ciDocs = readFileSync(join(repoRoot, "docs/CI.md"), "utf8");
  if (channel && !ciDocs.includes(channel)) {
    errors.push(`docs/CI.md must document pinned Rust version ${channel}`);
  }

  return {
    ok: errors.length === 0,
    channel,
    entries,
    errors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = validateRustToolchainAlignment(root);
  if (!res.ok) {
    for (const err of res.errors) {
      logger.error("rust-toolchain-check-failed", err);
    }
    process.exitCode = 1;
  } else {
    logger.info(
      "rust-toolchain-check-passed",
      `rust-toolchain.toml and ${res.entries.length} workflow step(s) are pinned to Rust ${res.channel}`,
    );
  }
}
