// Copyright (c) 2026 Sub Rosa contributors
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkTemplate, checkTemplates } from './check-env-examples.mjs';

test('ignores comments and blank lines, and permits public values and placeholders', () => {
  const source = [
    '# API_KEY=commented',
    '',
    'PUBLIC_ID=C123',
    'RPC_URL=https://example.com',
    'NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
    'API_KEY="<YOUR_API_KEY>"',
    'SECOND_API_KEY="<YOUR_API_KEY>" # set at runtime',
    'KEEPER_SECRET= # supplied at runtime',
    'OTHER_SECRET=${OTHER_SECRET}',
    'export PASSWORD=CHANGE_ME',
  ].join('\n');
  assert.deepEqual(checkTemplate(source, 'test.env'), []);
});

test('reports duplicate active names with both line numbers, including quoted assignments', () => {
  const errors = checkTemplate('# A=old\nA="one"\n\nexport A=two\n', 'test.env');
  assert.deepEqual(errors, ['test.env:4: duplicate A (first at line 2)']);
});

test('rejects populated credential fields without revealing their values', () => {
  const value = 'sensitive-material-123';
  const errors = checkTemplate(`STELLAR_SECRET_KEY='${value}'\n`, 'test.env');
  assert.deepEqual(errors, ['test.env:1: unsafe secret-shaped value for STELLAR_SECRET_KEY']);
  assert.doesNotMatch(errors.join(' '), /sensitive-material-123/);
});

test('rejects recognizable secret values even under an innocuous key', () => {
  const samples = [
    `MISC=S${'A'.repeat(55)}`,
    `MISC=AKIA${'A'.repeat(16)}`,
    `MISC=ghp_${'a'.repeat(24)}`,
    `MISC=sk_live_${'a'.repeat(24)}`,
    `MISC=sk-${'a'.repeat(24)}`,
    'MISC="-----BEGIN PRIVATE KEY-----"',
  ];
  for (const sample of samples) {
    assert.match(checkTemplate(sample, 'test.env')[0], /unsafe secret-shaped value for MISC/);
  }
});

test('checks each required template independently and fails when one is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-example-check-'));
  try {
    const root = join(dir, 'root.env');
    const web = join(dir, 'web.env');
    writeFileSync(root, 'SHARED=public\nSHARED=again\n');
    writeFileSync(web, 'SHARED=public\nAPI_KEY=unsafe-value\n');
    assert.deepEqual(checkTemplates([['root', root], ['web', web]]), [
      'root:2: duplicate SHARED (first at line 1)',
      'web:2: unsafe secret-shaped value for API_KEY',
    ]);
    assert.deepEqual(checkTemplates([['missing', join(dir, 'missing.env')]]), [
      'missing: unable to read required environment template',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository templates pass the command line check', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-env-examples.mjs', import.meta.url))], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Environment templates are valid/);
});
