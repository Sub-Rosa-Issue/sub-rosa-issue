// Copyright (c) 2026 Sub Rosa contributors
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { test, describe, before, after, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLockfileSources, formatErrors } from './check-lockfile-sources.mjs';

let TEST_DIR;

function createLockfile(content) {
  const path = join(TEST_DIR, 'pnpm-lock.yaml');
  writeFileSync(path, content, 'utf8');
  return path;
}

function createAllowlist(content) {
  const path = join(TEST_DIR, 'lockfile-allowlist.json');
  writeFileSync(path, JSON.stringify(content), 'utf8');
  return path;
}

describe('checkLockfileSources', () => {
  let lockfilePath;
  let allowlistPath;

  before(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'lockfile-check-'));
  });

  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Default allowlist
    allowlistPath = createAllowlist({ allowlist: [] });
  });

  test('allows standard registry packages with integrity only', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution: {integrity: sha512-abc123}
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('allows HTTPS tarball from known registry', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      tarball: https://registry.npmjs.org/example-pkg/-/example-pkg-1.0.0.tgz
      integrity: sha512-abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('allows HTTPS tarball from yarn registry', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      tarball: https://registry.yarnpkg.com/example-pkg/-/example-pkg-1.0.0.tgz
      integrity: sha512-abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('rejects git source without allowlist', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      type: git
      repo: https://github.com/user/repo.git
      commit: abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /git source not allowed/);
    assert.match(errors[0], /github.com/);
  });

  test('allows git source when host is in allowlist', () => {
    allowlistPath = createAllowlist({ allowlist: ['github.com'] });
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      type: git
      repo: https://github.com/user/repo.git
      commit: abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('allows git subdomain when parent domain is in allowlist', () => {
    allowlistPath = createAllowlist({ allowlist: ['github.com'] });
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      type: git
      repo: https://api.github.com/user/repo.git
      commit: abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('rejects file: source', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      type: file
      path: ./local-package
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /file: source not allowed/);
  });

  test('rejects non-HTTPS tarball', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      tarball: http://registry.npmjs.org/example-pkg/-/example-pkg-1.0.0.tgz
      integrity: sha512-abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /non-HTTPS tarball not allowed/);
  });

  test('rejects tarball from unknown registry host', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      tarball: https://registry.unknown.com/example-pkg/-/example-pkg-1.0.0.tgz
      integrity: sha512-abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unrecognized registry host/);
  });

  test('allows tarball from unknown registry when host is in allowlist', () => {
    allowlistPath = createAllowlist({ allowlist: ['registry.unknown.com'] });
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      tarball: https://registry.unknown.com/example-pkg/-/example-pkg-1.0.0.tgz
      integrity: sha512-abc123
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('rejects link: source in packages section', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution:
      link: ../some-path
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /link: source not allowed/);
  });

  test('allows workspace link: dependencies in importers', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      '@sub-rosa/sdk':
        specifier: workspace:*
        version: link:../../packages/sdk
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.deepEqual(errors, []);
  });

  test('rejects external link: dependencies in importers', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      'external-pkg':
        specifier: link:/absolute/path
        version: link:/absolute/path
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /external link: dependency not allowed/);
  });

  test('rejects relative link: that is not workspace-style', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      'external-pkg':
        specifier: link:./local-dep
        version: link:./local-dep
`);
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /external link: dependency not allowed/);
  });

  test('formats errors correctly', () => {
    const errors = ['pkg1: git source not allowed', 'pkg2: file: source not allowed'];
    const formatted = formatErrors(errors);
    assert.match(formatted, /Lockfile source policy violations found/);
    assert.match(formatted, /pkg1: git source not allowed/);
    assert.match(formatted, /pkg2: file: source not allowed/);
    assert.match(formatted, /config\/lockfile-allowlist.json/);
  });

  test('formats success correctly', () => {
    const formatted = formatErrors([]);
    assert.equal(formatted, '✅ All lockfile sources are allowed.');
  });

  test('handles missing allowlist file gracefully', () => {
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution: {integrity: sha512-abc123}
`);
    const missingAllowlistPath = join(TEST_DIR, 'missing-allowlist.json');
    const errors = checkLockfileSources(lockfilePath, missingAllowlistPath);
    assert.deepEqual(errors, []);
  });

  test('handles malformed allowlist gracefully', () => {
    const badAllowlistPath = join(TEST_DIR, 'bad-allowlist.json');
    writeFileSync(badAllowlistPath, 'not json', 'utf8');
    lockfilePath = createLockfile(`
lockfileVersion: '9.0'
packages:
  'example-pkg@1.0.0':
    resolution: {integrity: sha512-abc123}
`);
    assert.throws(() => checkLockfileSources(lockfilePath, badAllowlistPath), /Failed to load allowlist/);
  });

  test('actual repository lockfile passes', () => {
    const actualLockfile = new URL('../pnpm-lock.yaml', import.meta.url);
    const actualAllowlist = new URL('../config/lockfile-allowlist.json', import.meta.url);
    const errors = checkLockfileSources(actualLockfile, actualAllowlist);
    assert.deepEqual(errors, []);
  });
});