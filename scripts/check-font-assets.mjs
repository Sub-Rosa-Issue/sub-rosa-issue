#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { openSync, readSync, closeSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WOFF_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x46]); // "wOFF"
export const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]); // "wOF2"

/**
 * Reads ONLY the first 4 bytes of a font file and checks its magic bytes.
 * The file is never executed or evaluated.
 */
export function verifyFontMagicBytes(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(4);
    const bytesRead = readSync(fd, buffer, 0, 4, 0);
    if (bytesRead < 4) {
      return false;
    }
    if (filePath.endsWith(".woff2")) {
      return buffer.equals(WOFF2_MAGIC);
    }
    if (filePath.endsWith(".woff")) {
      return buffer.equals(WOFF_MAGIC);
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/**
 * Discovers font files in repository using git ls-files if available,
 * or recursively walking the directory as a fallback.
 */
export function discoverFontFiles(repoRoot = process.cwd()) {
  try {
    const output = execSync('git ls-files "*.woff" "*.woff2"', {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return output
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((rel) => join(repoRoot, rel));
  } catch {
    return walkFontFiles(repoRoot);
  }
}

function walkFontFiles(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFontFiles(full));
      } else if (entry.name.endsWith(".woff") || entry.name.endsWith(".woff2")) {
        results.push(full);
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return results;
}

export function checkFontAssets(fontFiles, repoRoot = process.cwd()) {
  const invalidFiles = [];
  for (const file of fontFiles) {
    if (!verifyFontMagicBytes(file)) {
      invalidFiles.push(relative(repoRoot, file) || file);
    }
  }
  return invalidFiles;
}

export function run(repoRoot = process.cwd()) {
  const files = discoverFontFiles(repoRoot);
  const invalid = checkFontAssets(files, repoRoot);

  if (invalid.length > 0) {
    for (const filePath of invalid) {
      console.error(filePath);
    }
    process.exit(1);
  }

  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  run();
}
