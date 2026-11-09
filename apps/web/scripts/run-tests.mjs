#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEB_ROOT = resolve(__dirname, "..");

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);

const TEST_FILE_PATTERN = /\.test\.tsx?$/;
const MODULE_MOCK_PATTERN = /\bmock\.module\s*\(/;

/**
 * Deterministically discover every `*.test.ts` and `*.test.tsx` file under `rootDir`.
 * Returns POSIX-normalized paths relative to `rootDir`, sorted lexicographically.
 *
 * @param {string} [rootDir]
 * @returns {string[]}
 */
export function discoverWebTestFiles(rootDir = DEFAULT_WEB_ROOT) {
  /** @type {string[]} */
  const discovered = [];

  /** @param {string} currentDir */
  function walk(currentDir) {
    if (!existsSync(currentDir)) return;
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(join(currentDir, entry.name));
        continue;
      }
      if (!entry.isFile() || !TEST_FILE_PATTERN.test(entry.name)) continue;
      const relPath = relative(rootDir, join(currentDir, entry.name)).replace(
        /\\/g,
        "/",
      );
      discovered.push(relPath);
    }
  }

  walk(rootDir);
  return discovered.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Partition discovered web test files into standard tests and tests that use
 * `mock.module(...)` (which require `--experimental-test-module-mocks`).
 *
 * @param {string[]} files
 * @param {string} [rootDir]
 * @returns {{ standardTests: string[], moduleMockTests: string[] }}
 */
export function partitionWebTestFiles(files, rootDir = DEFAULT_WEB_ROOT) {
  /** @type {string[]} */
  const standardTests = [];
  /** @type {string[]} */
  const moduleMockTests = [];

  for (const relPath of files) {
    const absPath = resolve(rootDir, relPath);
    const source = existsSync(absPath) ? readFileSync(absPath, "utf8") : "";
    if (MODULE_MOCK_PATTERN.test(source)) {
      moduleMockTests.push(relPath);
    } else {
      standardTests.push(relPath);
    }
  }

  return { standardTests, moduleMockTests };
}

/**
 * Execute discovered web tests in deterministic batches.
 *
 * @param {string} [rootDir]
 * @param {{ spawn?: typeof spawnSync }} [options]
 * @returns {{ status: number, files: string[], standardTests: string[], moduleMockTests: string[] }}
 */
export function runWebTests(rootDir = DEFAULT_WEB_ROOT, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  const files = discoverWebTestFiles(rootDir);
  if (files.length === 0) {
    process.stderr.write("No web test files (*.test.ts / *.test.tsx) found.\n");
    return { status: 1, files, standardTests: [], moduleMockTests: [] };
  }

  const { standardTests, moduleMockTests } = partitionWebTestFiles(
    files,
    rootDir,
  );

  if (standardTests.length > 0) {
    const res = spawn(
      process.execPath,
      ["--import", "tsx", "--test", ...standardTests],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
    if ((res.status ?? 1) !== 0) {
      return {
        status: res.status ?? 1,
        files,
        standardTests,
        moduleMockTests,
      };
    }
  }

  for (const mockTestFile of moduleMockTests) {
    const res = spawn(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        mockTestFile,
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
    if ((res.status ?? 1) !== 0) {
      return {
        status: res.status ?? 1,
        files,
        standardTests,
        moduleMockTests,
      };
    }
  }

  return { status: 0, files, standardTests, moduleMockTests };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    const files = discoverWebTestFiles(DEFAULT_WEB_ROOT);
    for (const file of files) {
      process.stdout.write(`${file}\n`);
    }
    return;
  }

  const outcome = runWebTests(DEFAULT_WEB_ROOT);
  if (outcome.status !== 0) {
    process.exit(outcome.status);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
