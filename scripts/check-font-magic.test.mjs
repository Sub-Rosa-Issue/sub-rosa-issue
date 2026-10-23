// Copyright (c) 2026 Sub Rosa contributors
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFontAssets, formatErrors } from './check-font-magic.mjs';

let TEST_DIR;

function createFontFile(name, content) {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return path;
}

describe('checkFontAssets', () => {
  beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'font-magic-check-'));
    mkdirSync(join(TEST_DIR, 'subdir'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('valid woff2 passes', () => {
    createFontFile('valid.woff2', Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]));
    const errors = checkFontAssets(TEST_DIR);
    assert.deepEqual(errors, []);
  });

  test('valid woff passes', () => {
    createFontFile('valid.woff', Buffer.from([0x77, 0x4F, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00]));
    const errors = checkFontAssets(TEST_DIR);
    assert.deepEqual(errors, []);
  });

  test('text file as woff2 fails', () => {
    createFontFile('fake.woff2', 'this is not a font');
    const errors = checkFontAssets(TEST_DIR);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid woff2 magic bytes/);
    assert.match(errors[0], /fake\.woff2/);
  });

  test('text file as woff fails', () => {
    createFontFile('fake.woff', 'also not a font');
    const errors = checkFontAssets(TEST_DIR);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid woff magic bytes/);
    assert.match(errors[0], /fake\.woff/);
  });

  test('too small file fails', () => {
    createFontFile('tiny.woff2', 'wof');
    const errors = checkFontAssets(TEST_DIR);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /file too small/);
  });

  test('valid files in subdirectory pass', () => {
    createFontFile('subdir/nested.woff2', Buffer.from([0x77, 0x4F, 0x46, 0x32]));
    createFontFile('subdir/nested.woff', Buffer.from([0x77, 0x4F, 0x46, 0x46]));
    const errors = checkFontAssets(TEST_DIR);
    assert.deepEqual(errors, []);
  });

  test('invalid file in subdirectory fails with relative path', () => {
    createFontFile('subdir/bad.woff2', 'not a font');
    const errors = checkFontAssets(TEST_DIR);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /subdir\/bad\.woff2/);
  });

  test('ignores node_modules directory', () => {
    mkdirSync(join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
    createFontFile('node_modules/pkg/ignored.woff2', 'not a font');
    const errors = checkFontAssets(TEST_DIR);
    assert.deepEqual(errors, []);
  });

  test('ignores .git directory', () => {
    mkdirSync(join(TEST_DIR, '.git', 'objects'), { recursive: true });
    createFontFile('.git/objects/ignored.woff', 'not a font');
    const errors = checkFontAssets(TEST_DIR);
    assert.deepEqual(errors, []);
  });

  test('formatErrors success', () => {
    const formatted = formatErrors([]);
    assert.equal(formatted, '✅ All WOFF/WOFF2 assets have valid magic bytes.');
  });

  test('formatErrors failure', () => {
    const errors = ['path/to/bad.woff2: invalid woff2 magic bytes'];
    const formatted = formatErrors(errors);
    assert.match(formatted, /Invalid font assets/);
    assert.match(formatted, /path\/to\/bad\.woff2/);
  });

  test('repository has no committed font assets', () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const errors = checkFontAssets(repoRoot);
    assert.deepEqual(errors, []);
  });
});