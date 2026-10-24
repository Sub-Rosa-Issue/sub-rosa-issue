#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-rust-audit");

export const PINNED_CARGO_AUDIT_VERSION = "0.21.2";
export const INSTALL_COMMAND = `cargo install cargo-audit --version ${PINNED_CARGO_AUDIT_VERSION} --locked`;
export const AUDIT_COMMAND = "cargo audit --locked --deny warnings";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Parse `Cargo.lock` package blocks and verify lockfile integrity for auditing.
 * @param {string} lockText
 */
export function inspectCargoLock(lockText) {
  const errors = [];
  if (!lockText || !lockText.includes("[[package]]")) {
    errors.push("Cargo.lock does not contain any [[package]] entries");
    return { packages: [], errors };
  }

  const blocks = lockText.split(/\r?\n\[\[package\]\]\r?\n/).slice(1);
  const packages = [];

  for (const block of blocks) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    const source = block.match(/^source\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    const checksum = block.match(/^checksum\s*=\s*"([^"]+)"/m)?.[1] ?? null;

    if (!name || !version) {
      errors.push("Malformed [[package]] entry missing name or version in Cargo.lock");
      continue;
    }

    if (source && source.startsWith("registry+")) {
      if (!checksum || !/^[0-9a-f]{64}$/.test(checksum)) {
        errors.push(
          `Registry package ${name}@${version} is missing a 64-hex SHA-256 checksum`,
        );
      }
    }

    packages.push({ name, version, source, checksum });
  }

  return { packages, errors };
}

/**
 * Validate `audit.toml` policy settings so known vulnerable advisories are blocking.
 * @param {string} auditTomlText
 */
export function inspectAuditToml(auditTomlText) {
  const errors = [];

  if (!auditTomlText.includes("[advisories]")) {
    errors.push("audit.toml must define an [advisories] section");
  }
  if (!/deny\s*=\s*\[\s*"warnings"\s*\]/.test(auditTomlText)) {
    errors.push('audit.toml must set deny = ["warnings"] so advisories are blocking');
  }
  if (!auditTomlText.includes(`cargo-audit ${PINNED_CARGO_AUDIT_VERSION}`)) {
    errors.push(
      `audit.toml must document the pinned cargo-audit ${PINNED_CARGO_AUDIT_VERSION} version`,
    );
  }

  const ignoreMatch = auditTomlText.match(/^\s*ignore\s*=\s*\[([\s\S]*?)\]/m);
  if (!ignoreMatch) {
    errors.push("audit.toml must explicitly declare ignore = [] under [advisories]");
  } else {
    const ignoredIds = Array.from(
      ignoreMatch[1].matchAll(/"(RUSTSEC-[^"]+)"/g),
      (m) => m[1],
    );
    if (ignoredIds.length > 0) {
      errors.push(
        `audit.toml ignores RustSec advisories (${ignoredIds.join(", ")}); known vulnerable advisories must remain blocking`,
      );
    }
  }

  return { errors };
}

/**
 * Validate the workspace RustSec audit configuration and committed Cargo.lock.
 * @param {string} [rootDir]
 */
export function validateRustAuditSetup(rootDir = DEFAULT_ROOT) {
  const errors = [];
  const cargoLockPath = resolve(rootDir, "Cargo.lock");
  const auditTomlPath = resolve(rootDir, "audit.toml");
  const pkgJsonPath = resolve(rootDir, "package.json");
  const ciDocsPath = resolve(rootDir, "docs/CI.md");

  if (!existsSync(cargoLockPath)) {
    errors.push("Missing committed Cargo.lock at repository root");
  } else {
    const lockRes = inspectCargoLock(readFileSync(cargoLockPath, "utf8"));
    errors.push(...lockRes.errors);
  }

  if (!existsSync(auditTomlPath)) {
    errors.push("Missing audit.toml at repository root");
  } else {
    const tomlRes = inspectAuditToml(readFileSync(auditTomlPath, "utf8"));
    errors.push(...tomlRes.errors);
  }

  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    if (!scripts["rust:audit:check"]) {
      errors.push("package.json must define the rust:audit:check script");
    }
    if (!scripts["rust:audit:test"]) {
      errors.push("package.json must define the rust:audit:test script");
    }
  } else {
    errors.push("Missing package.json at repository root");
  }

  if (existsSync(ciDocsPath)) {
    const docs = readFileSync(ciDocsPath, "utf8");
    if (!docs.includes(PINNED_CARGO_AUDIT_VERSION)) {
      errors.push(
        `docs/CI.md must document pinned cargo-audit version ${PINNED_CARGO_AUDIT_VERSION}`,
      );
    }
    if (!docs.includes(AUDIT_COMMAND)) {
      errors.push(`docs/CI.md must document "${AUDIT_COMMAND}"`);
    }
  } else {
    errors.push("Missing docs/CI.md");
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const rootDir = process.env.RUST_AUDIT_ROOT || DEFAULT_ROOT;
  const result = validateRustAuditSetup(rootDir);

  if (!result.ok) {
    for (const err of result.errors) {
      diagnostics.error("rust-audit-check-failed", `FAIL: ${err}`);
    }
    process.exit(1);
  }

  diagnostics.info(
    "rust-audit-check-passed",
    `PASS: RustSec audit policy (cargo-audit ${PINNED_CARGO_AUDIT_VERSION}) and committed Cargo.lock are valid.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
