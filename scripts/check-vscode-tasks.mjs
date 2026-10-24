#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "artifacts",
  "coverage",
  ".turbo",
  "tmp-bindings",
  "target",
]);

/**
 * Strip `//` line comments and `/* ... * /` block comments from JSONC text
 * while preserving string literals, without executing or evaluating any content.
 */
export function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      } else if (ch === "\n" || ch === "\r") {
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else {
      out += ch;
    }
  }

  return out;
}

/**
 * Recursively find all `.vscode/tasks.json` files under `rootDir`.
 */
export function findVscodeTaskFiles(rootDir = DEFAULT_ROOT, currentDir = rootDir, out = []) {
  if (!existsSync(currentDir)) return out;
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".vscode") {
        const tasksFile = join(full, "tasks.json");
        if (existsSync(tasksFile)) {
          out.push(tasksFile);
        }
      } else {
        findVscodeTaskFiles(rootDir, full, out);
      }
    }
  }
  return out;
}

/**
 * Inspect raw `.vscode/tasks.json` text for `"runOn": "folderOpen"` without
 * executing or parsing task commands.
 */
export function hasFolderOpenTrigger(rawContent) {
  const uncommented = stripJsonComments(rawContent);
  return /"runOn"\s*:\s*"folderOpen"/.test(uncommented);
}

/**
 * Scan a repository root and return relative paths of `.vscode/tasks.json`
 * files that configure `runOn: "folderOpen"`.
 */
export function scanVscodeTasks(rootDir = DEFAULT_ROOT) {
  const taskFiles = findVscodeTaskFiles(rootDir);
  const offending = [];

  for (const absPath of taskFiles) {
    const raw = readFileSync(absPath, "utf8");
    if (hasFolderOpenTrigger(raw)) {
      offending.push(relative(rootDir, absPath).replace(/\\/g, "/"));
    }
  }

  return offending;
}

function main() {
  const args = process.argv.slice(2);
  let rootDir = DEFAULT_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && i + 1 < args.length) {
      rootDir = resolve(args[++i]);
    }
  }

  const offending = scanVscodeTasks(rootDir);
  if (offending.length > 0) {
    for (const relPath of offending) {
      process.stdout.write(`${relPath}\n`);
    }
    process.stderr.write(
      `❌ Rejected ${offending.length} VS Code task file(s) with automatic "runOn": "folderOpen".\n`,
    );
    process.exit(1);
  }

  process.stdout.write("✅ No VS Code tasks with automatic folderOpen execution found.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
