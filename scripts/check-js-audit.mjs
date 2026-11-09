#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-js-audit");

export const AUDIT_SEVERITY_THRESHOLD = "high";
export const AUDIT_COMMAND = `pnpm audit --prod --audit-level=${AUDIT_SEVERITY_THRESHOLD}`;
export const LOCKFILE_VERSION = "9.0";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Inspect `pnpm-lock.yaml` to ensure a deterministic v9 lockfile with integrity
 * digests is committed for production dependency auditing.
 * @param {string} lockText
 */
export function inspectPnpmLock(lockText) {
  const errors = [];
  if (!lockText || !lockText.trim()) {
    errors.push("pnpm-lock.yaml is empty");
    return { integrityCount: 0, errors };
  }

  const versionMatch = lockText.match(/^lockfileVersion:\s*['"]?([^'"\r\n]+)['"]?/m);
  if (!versionMatch || versionMatch[1] !== LOCKFILE_VERSION) {
    errors.push(
      `pnpm-lock.yaml must declare lockfileVersion: '${LOCKFILE_VERSION}' (found ${versionMatch?.[1] ?? "none"})`,
    );
  }

  if (!/^importers:/m.test(lockText)) {
    errors.push("pnpm-lock.yaml is missing the importers: section");
  }

  const integrityMatches = lockText.match(/integrity:\s*sha512-[A-Za-z0-9+/=]+/g) ?? [];
  if (integrityMatches.length === 0) {
    errors.push("pnpm-lock.yaml does not contain any sha512 package integrity digests");
  }

  return { integrityCount: integrityMatches.length, errors };
}

/**
 * Inspect root `package.json` scripts and `pnpm.auditConfig` exception policy.
 * @param {Record<string, unknown>} pkg
 */
export function inspectPackageJsonAuditPolicy(pkg) {
  const errors = [];
  const scripts = /** @type {Record<string, string>} */ (pkg?.scripts ?? {});

  if (scripts["js:audit"] !== AUDIT_COMMAND) {
    errors.push(`package.json must define "js:audit": "${AUDIT_COMMAND}"`);
  }
  if (!scripts["js:audit:check"]) {
    errors.push("package.json must define the js:audit:check script");
  }
  if (!scripts["js:audit:test"]) {
    errors.push("package.json must define the js:audit:test script");
  }

  const pnpmConfig = /** @type {Record<string, any>} */ (pkg?.pnpm ?? {});
  const auditConfig = pnpmConfig.auditConfig ?? {};
  const ignoredGhsas = auditConfig.ignoreGhsas ?? [];

  if (!Array.isArray(ignoredGhsas)) {
    errors.push("package.json pnpm.auditConfig.ignoreGhsas must be an array when present");
  } else {
    for (const id of ignoredGhsas) {
      if (typeof id !== "string" || !/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i.test(id)) {
        errors.push(
          `Invalid GHSA identifier "${String(id)}" in pnpm.auditConfig.ignoreGhsas`,
        );
      }
    }
    if (ignoredGhsas.length > 0) {
      errors.push(
        `pnpm.auditConfig.ignoreGhsas contains unapproved advisory exceptions (${ignoredGhsas.join(", ")}); production advisories at or above ${AUDIT_SEVERITY_THRESHOLD} must remain blocking`,
      );
    }
  }

  return { errors };
}

/**
 * Validate the workspace JavaScript production dependency audit configuration.
 * @param {string} [rootDir]
 */
export function validateJsAuditSetup(rootDir = DEFAULT_ROOT) {
  const errors = [];
  const pnpmLockPath = resolve(rootDir, "pnpm-lock.yaml");
  const pkgJsonPath = resolve(rootDir, "package.json");
  const workflowPath = resolve(rootDir, ".github/workflows/coverage.yml");
  const ciDocsPath = resolve(rootDir, "docs/CI.md");

  if (!existsSync(pnpmLockPath)) {
    errors.push("Missing committed pnpm-lock.yaml at repository root");
  } else {
    const lockRes = inspectPnpmLock(readFileSync(pnpmLockPath, "utf8"));
    errors.push(...lockRes.errors);
  }

  if (!existsSync(pkgJsonPath)) {
    errors.push("Missing package.json at repository root");
  } else {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const pkgRes = inspectPackageJsonAuditPolicy(pkg);
    errors.push(...pkgRes.errors);
  }

  if (!existsSync(workflowPath)) {
    errors.push("Missing .github/workflows/coverage.yml");
  } else {
    const workflowText = readFileSync(workflowPath, "utf8");
    if (!workflowText.includes("pnpm js:audit:test") || !workflowText.includes("pnpm js:audit:check")) {
      errors.push(
        ".github/workflows/coverage.yml must run pnpm js:audit:test and pnpm js:audit:check",
      );
    }
  }

  if (!existsSync(ciDocsPath)) {
    errors.push("Missing docs/CI.md");
  } else {
    const docs = readFileSync(ciDocsPath, "utf8");
    if (!docs.includes(AUDIT_COMMAND)) {
      errors.push(`docs/CI.md must document "${AUDIT_COMMAND}"`);
    }
    if (!docs.includes("ignoreGhsas")) {
      errors.push("docs/CI.md must document the pnpm.auditConfig.ignoreGhsas exception policy");
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const rootDir = process.env.JS_AUDIT_ROOT || DEFAULT_ROOT;
  const result = validateJsAuditSetup(rootDir);

  if (!result.ok) {
    for (const err of result.errors) {
      diagnostics.error("js-audit-check-failed", `FAIL: ${err}`);
    }
    process.exit(1);
  }

  diagnostics.info(
    "js-audit-check-passed",
    `PASS: JavaScript production dependency audit policy (${AUDIT_COMMAND}) and committed pnpm-lock.yaml are valid.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
