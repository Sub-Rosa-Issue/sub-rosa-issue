#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

export const DEFAULT_AUDIT_LEVEL = "high";
export const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Build the exact pnpm CLI arguments for a production-only audit.
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
 * Evaluate parsed `pnpm audit --prod --json` output against the configured
 * severity threshold and validated exception list.
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
  const advisoriesObj = report?.advisories ?? {};

  for (const [key, adv] of Object.entries(advisoriesObj)) {
    const id = String(adv.github_advisory_id ?? adv.id ?? key);
    const pkg = String(adv.module_name ?? adv.name ?? "unknown");
    const severity = String(adv.severity ?? "info").toLowerCase();
    const rank = SEVERITY_RANK[severity] ?? 0;

    if (rank < thresholdRank) continue;

    if (activeExceptionMap.has(`${id}:${pkg}`)) {
      ignoredAdvisories.push({ id, package: pkg, severity });
    } else {
      blockingAdvisories.push({
        id,
        package: pkg,
        severity,
        title: adv.title ?? "Production dependency vulnerability",
      });
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

function loadExceptionsFile(exceptionsPath) {
  if (!exceptionsPath || !existsSync(exceptionsPath)) return [];
  const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  return Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
}

function main() {
  const args = process.argv.slice(2);
  let auditLevel = process.env.PNPM_AUDIT_LEVEL ?? DEFAULT_AUDIT_LEVEL;
  let fixturePath = null;
  let exceptionsPath = resolve(DEFAULT_ROOT, "audit-exceptions.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--audit-level" && i + 1 < args.length) {
      auditLevel = args[++i];
    } else if (args[i] === "--fixture" && i + 1 < args.length) {
      fixturePath = resolve(args[++i]);
    } else if (args[i] === "--exceptions" && i + 1 < args.length) {
      exceptionsPath = resolve(args[++i]);
    }
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
        process.stderr.write(
          `❌ Failed to execute pnpm ${pnpmArgs.join(" ")}: ${err.message}\n`,
        );
        process.exit(1);
      }
    }
  }

  const report = JSON.parse(rawJson);
  const exceptions = loadExceptionsFile(exceptionsPath);
  const evaluation = evaluateAuditReport(report, { auditLevel, exceptions });

  if (!evaluation.ok) {
    for (const reason of evaluation.invalidExceptions) {
      process.stderr.write(`❌ Invalid audit exception: ${reason}\n`);
    }
    for (const adv of evaluation.blockingAdvisories) {
      process.stderr.write(
        `❌ [${adv.severity.toUpperCase()}] ${adv.id} in ${adv.package}: ${adv.title}\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(
    `✅ Production dependency audit passed (threshold=${auditLevel}, exceptions=${evaluation.ignoredAdvisories.length}).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
