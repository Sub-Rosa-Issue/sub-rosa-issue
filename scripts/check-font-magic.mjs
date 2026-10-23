// Copyright (c) 2026 Sub Rosa contributors
import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Magic bytes as Uint8Array for comparison
const MAGIC_WOFF = new Uint8Array([0x77, 0x4F, 0x46, 0x46]); // 'wOFF'
const MAGIC_WOFF2 = new Uint8Array([0x77, 0x4F, 0x46, 0x32]); // 'wOF2'

const MAGIC_NAMES = {
  woff: 'wOFF',
  woff2: 'wOF2',
};

/**
 * Read exactly 4 bytes from the start of a file.
 * Returns Uint8Array of length 4, or null if file too small.
 */
function readMagicBytes(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    const bytesRead = readSync(fd, buffer, 0, 4, 0);
    if (bytesRead < 4) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Check if a file has the correct magic bytes for its extension.
 * Returns null if valid, or an error message string if invalid.
 */
function checkFontMagic(filePath, relPath) {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size < 4) {
      return `${relPath}: file too small (${stat.size} bytes) to contain magic bytes`;
    }

    const bytes = readMagicBytes(filePath);
    if (!bytes) {
      return `${relPath}: unable to read magic bytes`;
    }

    if (relPath.endsWith('.woff2')) {
      if (!bytes.every((b, i) => b === MAGIC_WOFF2[i])) {
        return `${relPath}: invalid woff2 magic bytes (expected ${MAGIC_NAMES.woff2}, got ${bytesToHex(bytes)})`;
      }
    } else if (relPath.endsWith('.woff')) {
      if (!bytes.every((b, i) => b === MAGIC_WOFF[i])) {
        return `${relPath}: invalid woff magic bytes (expected ${MAGIC_NAMES.woff}, got ${bytesToHex(bytes)})`;
      }
    }
    return null;
  } catch (err) {
    return `${relPath}: error reading file: ${err.message}`;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/**
 * Recursively find all .woff and .woff2 files in the repo.
 */
function findFontFiles(dir, base = ROOT) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'target', '.git', 'artifacts', 'tmp-bindings'].includes(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFontFiles(full, base));
      } else if (entry.isFile() && (entry.name.endsWith('.woff') || entry.name.endsWith('.woff2'))) {
        results.push({ full, rel: relative(base, full).replaceAll('\\', '/') });
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return results;
}

/**
 * Main check function. Returns array of error strings (empty if all valid).
 */
export function checkFontAssets(root = ROOT) {
  const fontFiles = findFontFiles(root);
  const errors = [];

  for (const { full, rel } of fontFiles) {
    const error = checkFontMagic(full, rel);
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * Format errors for CLI output.
 */
export function formatErrors(errors) {
  if (errors.length === 0) {
    return '✅ All WOFF/WOFF2 assets have valid magic bytes.';
  }
  return '❌ Invalid font assets:\n' + errors.map(e => `  ${e}`).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('check-font-magic.mjs')) {
  try {
    const errors = checkFontAssets();
    console.log(formatErrors(errors));
    if (errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}