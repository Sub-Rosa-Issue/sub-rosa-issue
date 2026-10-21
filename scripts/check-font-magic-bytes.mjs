#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
// Verify WOFF and WOFF2 magic bytes for committed font assets

import { readFileSync, statSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../packages/logging/src/index.cjs';

const diagnostics = createLogger("scripts.check-font-magic-bytes");

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const WOFF_MAGIC = Buffer.from([0x77, 0x4F, 0x46, 0x46]); // wOFF
const WOFF2_MAGIC = Buffer.from([0x77, 0x4F, 0x46, 0x32]); // wOF2

// Paths to exclude from checking (test fixtures, etc.)
const EXCLUDE_PATTERNS = [
  'fixtures/',
  'node_modules/',
];

function checkFile(filepath) {
  try {
    const buffer = readFileSync(filepath);
    // Show relative path if inside project, otherwise just the filename
    const relPath = filepath.startsWith(PROJECT_ROOT) 
      ? filepath.replace(PROJECT_ROOT + '/', '')
      : filepath.split('/').pop();

    if (filepath.endsWith('.woff2')) {
      if (buffer.length < 4) {
        return { ok: false, path: relPath, reason: 'file too small for WOFF2 magic bytes' };
      }
      if (!buffer.subarray(0, 4).equals(WOFF2_MAGIC)) {
        const actual = buffer.subarray(0, Math.min(4, buffer.length)).toString('hex');
        return { ok: false, path: relPath, reason: `invalid WOFF2 magic bytes (expected 774f4632, got ${actual})` };
      }
      return { ok: true, path: relPath };
    }

    if (filepath.endsWith('.woff')) {
      if (buffer.length < 4) {
        return { ok: false, path: relPath, reason: 'file too small for WOFF magic bytes' };
      }
      if (!buffer.subarray(0, 4).equals(WOFF_MAGIC)) {
        const actual = buffer.subarray(0, Math.min(4, buffer.length)).toString('hex');
        return { ok: false, path: relPath, reason: `invalid WOFF magic bytes (expected 774f4646, got ${actual})` };
      }
      return { ok: true, path: relPath };
    }

    return { ok: true, path: relPath };
  } catch (err) {
    const relPath = filepath.startsWith(PROJECT_ROOT) 
      ? filepath.replace(PROJECT_ROOT + '/', '')
      : filepath.split('/').pop();
    return { ok: false, path: relPath, reason: `read error: ${err.message}` };
  }
}

function getFontFiles(target) {
  const resolved = target.startsWith('/') ? target : resolve(PROJECT_ROOT, target);
  const stat = statSync(resolved);
  
  if (stat.isFile()) {
    return [resolved];
  }
  
  // Directory - glob for font files (absolute: true doesn't work with cwd, so resolve manually)
  const woffFiles = globSync('**/*.woff', { cwd: resolved }).map(f => resolve(resolved, f));
  const woff2Files = globSync('**/*.woff2', { cwd: resolved }).map(f => resolve(resolved, f));
  const allFiles = [...woffFiles, ...woff2Files];
  
  // Filter out excluded paths
  return allFiles.filter(filepath => {
    const relPath = filepath.startsWith(PROJECT_ROOT) 
      ? filepath.replace(PROJECT_ROOT + '/', '')
      : filepath;
    return !EXCLUDE_PATTERNS.some(pattern => relPath.startsWith(pattern));
  });
}

export function checkFontMagicBytes(target = PROJECT_ROOT) {
  const allFiles = getFontFiles(target);
  const results = allFiles.map(checkFile);
  const failures = results.filter(r => !r.ok);

  return {
    checked: results.length,
    failed: failures.length,
    failures,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || PROJECT_ROOT;
  const result = checkFontMagicBytes(target);

  if (result.failed > 0) {
    for (const failure of result.failures) {
      diagnostics.error("fail", `${failure.path}: ${failure.reason}`);
    }
    process.exit(1);
  } else if (result.checked > 0) {
    diagnostics.info("ok", `OK  ${result.checked} font file(s) verified`);
    process.exit(0);
  } else {
    diagnostics.info("ok", "OK  no font files found");
    process.exit(0);
  }
}