#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-single-lockfile");

export const REQUIRED_PACKAGE_MANAGER = "pnpm@10.13.1";
export const REQUIRED_LOCKFILE = "pnpm-lock.yaml";
export const FORBIDDEN_LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
];

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Validate that pnpm is the single workspace package manager and only
 * `pnpm-lock.yaml` is present at the repository root.
 * @param {string} [rootDir]
 */
export function checkSingleLockfile(rootDir = DEFAULT_ROOT) {
  const errors = [];

  const requiredPath = resolve(rootDir, REQUIRED_LOCKFILE);
  if (!existsSync(requiredPath)) {
    errors.push(`Missing required root lockfile ${REQUIRED_LOCKFILE}`);
  }

  for (const forbidden of FORBIDDEN_LOCKFILES) {
    if (existsSync(resolve(rootDir, forbidden))) {
      errors.push(
        `Forbidden root lockfile "${forbidden}" found; only ${REQUIRED_LOCKFILE} is allowed`,
      );
    }
  }

  const gitignorePath = resolve(rootDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    errors.push("Missing .gitignore at repository root");
  } else {
    const gitignore = readFileSync(gitignorePath, "utf8");
    for (const pattern of ["package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"]) {
      if (!gitignore.includes(pattern)) {
        errors.push(`.gitignore must ignore root "${pattern}"`);
      }
    }
  }

  const pkgPath = resolve(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    errors.push("Missing package.json at repository root");
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.packageManager !== REQUIRED_PACKAGE_MANAGER) {
      errors.push(
        `package.json packageManager must be "${REQUIRED_PACKAGE_MANAGER}" (found "${pkg.packageManager ?? ""}")`,
      );
    }
  }

  const ciDocsPath = resolve(rootDir, "docs/CI.md");
  if (!existsSync(ciDocsPath)) {
    errors.push("Missing docs/CI.md");
  } else {
    const ciDocs = readFileSync(ciDocsPath, "utf8");
    if (!ciDocs.includes(REQUIRED_PACKAGE_MANAGER)) {
      errors.push(`docs/CI.md must document "${REQUIRED_PACKAGE_MANAGER}" as the required installer`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const res = checkSingleLockfile();
  if (!res.ok) {
    for (const err of res.errors) {
      diagnostics.error("single-lockfile-check-failed", `FAIL: ${err}`);
    }
    process.exit(1);
  }

  diagnostics.info(
    "single-lockfile-check-passed",
    `PASS: ${REQUIRED_PACKAGE_MANAGER} is enforced with ${REQUIRED_LOCKFILE} as the single root lockfile.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
