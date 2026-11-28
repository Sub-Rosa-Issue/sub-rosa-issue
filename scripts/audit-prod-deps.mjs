#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.audit-prod-deps");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

export const DEFAULT_AUDIT_LEVEL = "high";
export const AUDIT_COMMAND = "pnpm audit --prod --audit-level=high --json";
export const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Build the exact pnpm CLI arguments for a production-only audit.
 * @param {string} [auditLevel]
 */
export function buildPnpmAuditArgs(auditLevel = DEFAULT_AUDIT_LEVEL) {
  if (!(auditLevel in SEVERITY_RANK)) {
    throw new Error(`Unsupported audit severity level: ${auditLevel}`);
  }
  return ["audit", "--prod", `--audit-level=${auditLevel}`, "--json"];
}

/**
 * Validate a single time-boxed audit exception entry.
 * Every exception must include `id`, `package`, `reason`, `expiresOn` (ISO YYYY-MM-DD),
 * and `trackingIssue`.
 * @param {unknown} entry
 * @param {number} [nowMs]
 */
export function validateAuditException(entry, nowMs = Date.now()) {
  if (!entry || typeof entry !== "object") {
    return { valid: false, reason: "Exception entry must be an object" };
  }
  const required = ["id", "package", "reason", "expiresOn", "trackingIssue"];
  for (const field of required) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) {
      return {
        valid: false,
        reason: `Exception is missing required string field "${field}"`,
      };
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn)) {
    return {
      valid: false,
      reason: `Exception ${entry.id} has invalid expiresOn date "${entry.expiresOn}" (expected YYYY-MM-DD)`,
    };
  }
  const expiryMs = Date.parse(`${entry.expiresOn}T23:59:59.999Z`);
  if (!Number.isFinite(expiryMs) || expiryMs < nowMs) {
    return {
      valid: false,
      reason: `Exception ${entry.id} for ${entry.package} expired on ${entry.expiresOn}`,
    };
  }
  return { valid: true };
}

/**
 * Normalize advisories from either classic `advisories` maps or npm/pnpm
 * `vulnerabilities` objects into a common list.
 * @param {object} report
 */
export function collectAdvisories(report) {
  /** @type {{ id: string, package: string, severity: string, title: string }[]} */
  const list = [];
  const advisoriesObj = report?.advisories ?? {};

  for (const [key, adv] of Object.entries(advisoriesObj)) {
    if (!adv || typeof adv !== "object") continue;
    list.push({
      id: String(adv.github_advisory_id ?? adv.id ?? key),
      package: String(adv.module_name ?? adv.name ?? "unknown"),
      severity: String(adv.severity ?? "info").toLowerCase(),
      title: String(adv.title ?? "Production dependency vulnerability"),
    });
  }

  const vulns = report?.vulnerabilities;
  if (vulns && typeof vulns === "object" && !Array.isArray(vulns)) {
    for (const [pkgName, entry] of Object.entries(vulns)) {
      if (!entry || typeof entry !== "object") continue;
      const via = Array.isArray(entry.via) ? entry.via : [];
      const advisoryVia = via.filter((v) => v && typeof v === "object");
      if (advisoryVia.length === 0) {
        list.push({
          id: String(entry.name ?? pkgName),
          package: String(pkgName),
          severity: String(entry.severity ?? "info").toLowerCase(),
          title: String(entry.title ?? entry.name ?? "Production dependency vulnerability"),
        });
        continue;
      }
      for (const item of advisoryVia) {
        list.push({
          id: String(item.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] ?? item.source ?? item.id ?? pkgName),
          package: String(item.name ?? pkgName),
          severity: String(item.severity ?? entry.severity ?? "info").toLowerCase(),
          title: String(item.title ?? "Production dependency vulnerability"),
        });
      }
    }
  }

  return list;
}

/**
 * Evaluate parsed `pnpm audit --prod --json` output against the configured
 * severity threshold and validated exception list.
 * @param {object} report
 * @param {{ auditLevel?: string, exceptions?: object[], nowMs?: number }} [options]
 */
export function evaluateAuditReport(
  report,
  {
    auditLevel = DEFAULT_AUDIT_LEVEL,
    exceptions = [],
    nowMs = Date.now(),
  } = {},
) {
  if (!(auditLevel in SEVERITY_RANK)) {
    throw new Error(`Unsupported audit severity level: ${auditLevel}`);
  }
  const thresholdRank = SEVERITY_RANK[auditLevel];
  const invalidExceptions = [];
  const activeExceptionMap = new Map();

  for (const ex of exceptions) {
    const check = validateAuditException(ex, nowMs);
    if (!check.valid) {
      invalidExceptions.push(check.reason);
    } else {
      activeExceptionMap.set(`${ex.id}:${ex.package}`, ex);
    }
  }

  const blockingAdvisories = [];
  const ignoredAdvisories = [];

  for (const adv of collectAdvisories(report)) {
    const rank = SEVERITY_RANK[adv.severity] ?? 0;
    if (rank < thresholdRank) continue;

    if (activeExceptionMap.has(`${adv.id}:${adv.package}`)) {
      ignoredAdvisories.push({ id: adv.id, package: adv.package, severity: adv.severity });
    } else {
      blockingAdvisories.push(adv);
    }
  }

  return {
    ok: invalidExceptions.length === 0 && blockingAdvisories.length === 0,
    auditLevel,
    blockingAdvisories,
    ignoredAdvisories,
    invalidExceptions,
  };
}

/**
 * Load and return exception entries from audit-exceptions.json.
 * @param {string} exceptionsPath
 */
export function loadExceptionsFile(exceptionsPath) {
  if (!exceptionsPath || !existsSync(exceptionsPath)) return [];
  const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  return Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
}

/**
 * Validate that contributor-facing scripts, docs, exceptions file, and CI wiring exist.
 * @param {string} [rootDir]
 */
export function validateAuditProdSetup(rootDir = DEFAULT_ROOT) {
  const errors = [];
  const exceptionsPath = resolve(rootDir, "audit-exceptions.json");
  const pkgJsonPath = resolve(rootDir, "package.json");
  const ciDocsPath = resolve(rootDir, "docs/CI.md");
  const workflowPath = resolve(rootDir, ".github/workflows/coverage.yml");

  if (!existsSync(exceptionsPath)) {
    errors.push("Missing audit-exceptions.json at repository root");
  } else {
    try {
      const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
      if (!Array.isArray(parsed.exceptions)) {
        errors.push('audit-exceptions.json must define an "exceptions" array');
      }
    } catch (err) {
      errors.push(`audit-exceptions.json is not valid JSON: ${err.message}`);
    }
  }

  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    if (!scripts["audit:prod"]) {
      errors.push("package.json must define the audit:prod script");
    }
    if (!scripts["audit:prod:test"]) {
      errors.push("package.json must define the audit:prod:test script");
    }
  } else {
    errors.push("Missing package.json at repository root");
  }

  if (existsSync(ciDocsPath)) {
    const docs = readFileSync(ciDocsPath, "utf8");
    if (!docs.includes("Production dependency audit")) {
      errors.push('docs/CI.md must document the "Production dependency audit" section');
    }
    if (!docs.includes("--prod") || !docs.includes("audit-level")) {
      errors.push("docs/CI.md must document production-only pnpm audit with a severity threshold");
    }
    if (!docs.includes("audit-exceptions.json")) {
      errors.push("docs/CI.md must document the audit-exceptions.json exception process");
    }
  } else {
    errors.push("Missing docs/CI.md");
  }

  if (existsSync(workflowPath)) {
    const workflow = readFileSync(workflowPath, "utf8");
    if (!workflow.includes("pnpm audit:prod:test") || !workflow.includes("pnpm audit:prod")) {
      errors.push(
        ".github/workflows/coverage.yml must run pnpm audit:prod:test and pnpm audit:prod",
      );
    }
  } else {
    errors.push("Missing .github/workflows/coverage.yml");
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);
  let auditLevel = process.env.PNPM_AUDIT_LEVEL ?? DEFAULT_AUDIT_LEVEL;
  let fixturePath = null;
  let exceptionsPath = resolve(DEFAULT_ROOT, "audit-exceptions.json");
  let setupOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--audit-level" && i + 1 < args.length) {
      auditLevel = args[++i];
    } else if (args[i] === "--fixture" && i + 1 < args.length) {
      fixturePath = resolve(args[++i]);
    } else if (args[i] === "--exceptions" && i + 1 < args.length) {
      exceptionsPath = resolve(args[++i]);
    } else if (args[i] === "--setup-only") {
      setupOnly = true;
    }
  }

  const setup = validateAuditProdSetup(DEFAULT_ROOT);
  if (!setup.ok) {
    for (const err of setup.errors) {
      diagnostics.error("audit-prod-setup-failed", `FAIL: ${err}`);
    }
    process.exit(1);
  }

  if (setupOnly) {
    diagnostics.info(
      "audit-prod-setup-passed",
      `PASS: Production pnpm audit policy (threshold=${DEFAULT_AUDIT_LEVEL}) is configured.`,
    );
    return;
  }

  const pnpmArgs = buildPnpmAuditArgs(auditLevel);
  let rawJson;

  if (fixturePath) {
    rawJson = readFileSync(fixturePath, "utf8");
  } else {
    try {
      rawJson = execFileSync("pnpm", pnpmArgs, {
        cwd: DEFAULT_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      rawJson = err.stdout ? String(err.stdout) : "";
      if (!rawJson.trim()) {
        diagnostics.error(
          "audit-prod-exec-failed",
          `Failed to execute pnpm ${pnpmArgs.join(" ")}: ${err.message}`,
        );
        process.exit(1);
      }
    }
  }

  let report;
  try {
    report = JSON.parse(rawJson);
  } catch (err) {
    diagnostics.error("audit-prod-json-failed", `pnpm audit JSON parse failed: ${err.message}`);
    process.exit(1);
  }

  const exceptions = loadExceptionsFile(exceptionsPath);
  const evaluation = evaluateAuditReport(report, { auditLevel, exceptions });

  if (!evaluation.ok) {
    for (const reason of evaluation.invalidExceptions) {
      diagnostics.error("audit-prod-invalid-exception", `Invalid audit exception: ${reason}`);
    }
    for (const adv of evaluation.blockingAdvisories) {
      diagnostics.error(
        "audit-prod-blocking-advisory",
        `[${adv.severity.toUpperCase()}] ${adv.id} in ${adv.package}: ${adv.title}`,
      );
    }
    process.exit(1);
  }

  diagnostics.info(
    "audit-prod-passed",
    `Production dependency audit passed (threshold=${auditLevel}, exceptions=${evaluation.ignoredAdvisories.length}).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
