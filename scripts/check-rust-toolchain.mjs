#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-rust-toolchain");

export const PINNED_RUST_VERSION = "1.85.0";
export const REQUIRED_TARGET = "wasm32v1-none";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Validate `rust-toolchain.toml` content.
 * @param {string} tomlText
 */
export function inspectRustToolchainToml(tomlText) {
  const errors = [];
  const channelMatch = tomlText.match(/^\s*channel\s*=\s*"([^"]+)"/m);
  if (!channelMatch) {
    errors.push('rust-toolchain.toml is missing a channel = "..." entry');
  } else {
    const channel = channelMatch[1];
    if (/^(stable|beta|nightly)$/i.test(channel)) {
      errors.push(
        `rust-toolchain.toml uses moving channel "${channel}"; pin to an exactMAJOR.MINOR.PATCH version`,
      );
    } else if (!/^\d+\.\d+\.\d+$/.test(channel)) {
      errors.push(
        `rust-toolchain.toml channel "${channel}" must be an exact MAJOR.MINOR.PATCH version`,
      );
    } else if (channel !== PINNED_RUST_VERSION) {
      errors.push(
        `rust-toolchain.toml channel "${channel}" does not match reviewed version ${PINNED_RUST_VERSION}`,
      );
    }
  }

  if (!tomlText.includes(`"${REQUIRED_TARGET}"`)) {
    errors.push(
      `rust-toolchain.toml must include "${REQUIRED_TARGET}" in targets`,
    );
  }

  return { channel: channelMatch?.[1] ?? null, errors };
}

/**
 * Validate workspace Rust toolchain alignment across `rust-toolchain.toml`,
 * `Cargo.toml`, contract workflows, and `docs/CI.md`.
 * @param {string} [rootDir]
 */
export function validateRustToolchain(rootDir = DEFAULT_ROOT) {
  const errors = [];

  const toolchainPath = resolve(rootDir, "rust-toolchain.toml");
  const cargoTomlPath = resolve(rootDir, "Cargo.toml");
  const contractWfPath = resolve(rootDir, ".github/workflows/contract.yml");
  const bindingsWfPath = resolve(rootDir, ".github/workflows/bindings-check.yml");
  const ciDocsPath = resolve(rootDir, "docs/CI.md");

  let pinnedChannel = null;
  if (!existsSync(toolchainPath)) {
    errors.push("Missing rust-toolchain.toml at repository root");
  } else {
    const res = inspectRustToolchainToml(readFileSync(toolchainPath, "utf8"));
    pinnedChannel = res.channel;
    errors.push(...res.errors);
  }

  if (!existsSync(cargoTomlPath)) {
    errors.push("Missing Cargo.toml at repository root");
  } else {
    const cargoText = readFileSync(cargoTomlPath, "utf8");
    const rvMatch = cargoText.match(/^\s*rust-version\s*=\s*"([^"]+)"/m);
    if (!rvMatch) {
      errors.push('Cargo.toml [workspace.package] must declare rust-version = "1.85.0"');
    } else if (pinnedChannel && rvMatch[1] !== pinnedChannel) {
      errors.push(
        `Cargo.toml rust-version "${rvMatch[1]}" does not match rust-toolchain.toml "${pinnedChannel}"`,
      );
    }
  }

  if (existsSync(contractWfPath) && existsSync(bindingsWfPath)) {
    const contractWf = readFileSync(contractWfPath, "utf8");
    const bindingsWf = readFileSync(bindingsWfPath, "utf8");
    const contractRef =
      contractWf.match(/uses:\s*(dtolnay\/rust-toolchain@\S+)/)?.[1] ?? null;
    const bindingsRef =
      bindingsWf.match(/uses:\s*(dtolnay\/rust-toolchain@\S+)/)?.[1] ?? null;

    if (!contractRef || !bindingsRef) {
      errors.push(
        "Both contract.yml and bindings-check.yml must use dtolnay/rust-toolchain",
      );
    } else if (contractRef !== bindingsRef) {
      errors.push(
        `Rust toolchain action mismatch between contract.yml (${contractRef}) and bindings-check.yml (${bindingsRef})`,
      );
    }
  }

  if (!existsSync(ciDocsPath)) {
    errors.push("Missing docs/CI.md");
  } else {
    const docs = readFileSync(ciDocsPath, "utf8");
    if (!docs.includes(PINNED_RUST_VERSION)) {
      errors.push(
        `docs/CI.md must document the pinned Rust toolchain version ${PINNED_RUST_VERSION}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const res = validateRustToolchain();
  if (!res.ok) {
    for (const err of res.errors) {
      diagnostics.error("rust-toolchain-check-failed", `FAIL: ${err}`);
    }
    process.exit(1);
  }

  diagnostics.info(
    "rust-toolchain-check-passed",
    `PASS: Rust toolchain is pinned to ${PINNED_RUST_VERSION} (${REQUIRED_TARGET}) and aligned across Cargo.toml, workflows, and docs/CI.md.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
