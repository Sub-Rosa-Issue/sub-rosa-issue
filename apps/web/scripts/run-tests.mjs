#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_ROOT = resolve(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

function walkTestFiles(dir, baseDir, out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(fullPath, baseDir, out);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      out.push(relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Deterministically discover all `*.test.ts` and `*.test.tsx` files under
 * `apps/web/src` (or `<webRoot>/src`) in lexicographical POSIX path order.
 */
export function discoverWebTests(webRoot = DEFAULT_WEB_ROOT) {
  const srcDir = join(webRoot, "src");
  const all = walkTestFiles(srcDir, webRoot).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const standard = [];
  const moduleMocks = [];

  for (const relPath of all) {
    const content = readFileSync(join(webRoot, relPath), "utf8");
    if (/\bmock\.module\s*\(/.test(content)) {
      moduleMocks.push(relPath);
    } else {
      standard.push(relPath);
    }
  }

  return { all, standard, moduleMocks };
}

function runBatch(webRoot, args) {
  const res = spawnSync(process.execPath, args, {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
  return res.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  let webRoot = DEFAULT_WEB_ROOT;
  let listOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--list") {
      listOnly = true;
    } else if (args[i] === "--root" && i + 1 < args.length) {
      webRoot = resolve(args[i + 1]);
      i++;
    }
  }

  const { all, standard, moduleMocks } = discoverWebTests(webRoot);
  if (all.length === 0) {
    process.stderr.write(`❌ No web test files discovered under ${join(webRoot, "src")}\n`);
    process.exit(1);
  }

  if (listOnly) {
    for (const file of all) {
      process.stdout.write(`${file}\n`);
    }
    return;
  }

  if (standard.length > 0) {
    const code = runBatch(webRoot, ["--import", "tsx", "--test", ...standard]);
    if (code !== 0) process.exit(code);
  }

  if (moduleMocks.length > 0) {
    const code = runBatch(webRoot, [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      ...moduleMocks,
    ]);
    if (code !== 0) process.exit(code);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
