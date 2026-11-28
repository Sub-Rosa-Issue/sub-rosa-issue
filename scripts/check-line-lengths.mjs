// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-line-lengths");
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

// Default maximum line length (characters). Documented and at most 500.
const DEFAULT_MAX_LINE_LENGTH = 500;

// Config file patterns to scan
const CONFIG_PATTERNS = [
  // package.json files
  /^package\.json$/,
  // Common JS/TS config files
  /^vite\.config\.[cm]?[jt]s$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^postcss\.config\.[cm]?[jt]s$/,
  /^tailwind\.config\.[cm]?[jt]s$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^eslint\.config\.mjs$/,
  /^\.eslintrc\.(js|ts|json|yaml|yml)$/,
  /^next\.config\.[cm]?[jt]s$/,
  /^next\.config\.mjs$/,
  /^rollup\.config\.[cm]?[jt]s$/,
  /^webpack\.config\.[cm]?[jt]s$/,
  /^jest\.config\.[cm]?[jt]s$/,
  /^tsconfig\.json$/,
  /^tsconfig\..+\.json$/,
];

// Allowlist for legitimate files that may have long lines
// These are exact relative paths from repo root
const ALLOWLIST = new Set([
  "apps/web/package.json", // Long test script command line
]);

// Directories to skip entirely
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "artifacts",
  "coverage",
  ".turbo",
  "tmp-bindings",
  "contracts/round/test_snapshots", // generated snapshots
  "target",
]);

// File patterns to skip (lockfiles, generated snapshots)
const SKIP_FILE_PATTERNS = [
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /package-lock\.json$/,
  /Cargo\.lock$/,
  /\.snap$/,
  /\.snapshot\./,
  /test_snapshots.*\.json$/,
];

function shouldSkipDir(dirName) {
  return SKIP_DIRS.has(dirName);
}

function shouldSkipFile(filePath) {
  const relPath = relative(process.cwd(), filePath);
  // Check allowlist first
  if (ALLOWLIST.has(relPath)) {
    return true;
  }
  // Check skip patterns
  for (const pattern of SKIP_FILE_PATTERNS) {
    if (pattern.test(relPath) || pattern.test(basename(filePath))) {
      return true;
    }
  }
  return false;
}

function isConfigFile(fileName) {
  for (const pattern of CONFIG_PATTERNS) {
    if (pattern.test(fileName)) {
      return true;
    }
  }
  return false;
}

function walk(dir, results = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          walk(full, results);
        }
      } else if (isConfigFile(entry.name)) {
        if (!shouldSkipFile(full)) {
          results.push(full);
        }
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR" && error.code !== "EACCES") {
      throw error;
    }
  }
  return results;
}

function checkFile(filePath, maxLineLength) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > maxLineLength) {
      violations.push({
        file: relative(process.cwd(), filePath),
        line: i + 1,
        length: line.length,
      });
    }
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  let maxLineLength = DEFAULT_MAX_LINE_LENGTH;

  // Parse --max-line-length argument
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-line-length" && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1], 10);
      if (isNaN(parsed) || parsed <= 0) {
        diagnostics.info("fail", "Invalid --max-line-length value. Must be a positive integer.");
        process.exit(1);
      }
      maxLineLength = parsed;
      i++; // Skip next arg
    }
  }

  const configFiles = walk(process.cwd());
  let allViolations = [];

  for (const file of configFiles) {
    const violations = checkFile(file, maxLineLength);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    // CI prints paths and line numbers only (to stdout)
    for (const v of allViolations) {
      process.stdout.write(`${v.file}:${v.line}:${v.length}\n`);
    }
    diagnostics.info("fail", `Found ${allViolations.length} line(s) exceeding ${maxLineLength} characters in configuration files.`);
    process.exit(1);
  } else {
    diagnostics.info("pass", `All configuration files have lines ≤ ${maxLineLength} characters.`);
    process.exit(0);
  }
}

main();