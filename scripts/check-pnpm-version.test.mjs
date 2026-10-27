import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePackageManagerVersion,
  findWorkflowPnpmVersions,
  findMismatches,
} from './check-pnpm-version.mjs';

test('parsePackageManagerVersion extracts the version from a pnpm@x.y.z string', () => {
  const pkg = JSON.stringify({ packageManager: 'pnpm@10.13.1' });
  assert.equal(parsePackageManagerVersion(pkg), '10.13.1');
});

test('parsePackageManagerVersion throws when packageManager is missing', () => {
  assert.throws(() => parsePackageManagerVersion(JSON.stringify({})), /missing/);
});

test('parsePackageManagerVersion throws for a non-pnpm packageManager', () => {
  assert.throws(
    () => parsePackageManagerVersion(JSON.stringify({ packageManager: 'yarn@4.0.0' })),
    /Unrecognized packageManager format/,
  );
});

test('findWorkflowPnpmVersions reads the version from each workflow file', () => {
  const files = {
    'a.yml': [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: pnpm/action-setup@v4',
      '        with:',
      '          version: 10.13.1',
    ].join('\n'),
    'b.yml': [
      'jobs:',
      '  test:',
      '    steps:',
      "      - uses: pnpm/action-setup@v4",
      '        with:',
      '          version: "9.0.0"',
    ].join('\n'),
    'not-a-workflow.txt': 'irrelevant',
  };
  const result = findWorkflowPnpmVersions(
    '.github/workflows',
    (path) => files[path.split('/').pop()],
    () => Object.keys(files),
  );

  assert.deepEqual(result, [
    { file: 'a.yml', version: '10.13.1' },
    { file: 'b.yml', version: '9.0.0' },
  ]);
});

test('findWorkflowPnpmVersions ignores workflows with no pnpm/action-setup step', () => {
  const files = { 'rust-only.yml': 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n' };
  const result = findWorkflowPnpmVersions(
    '.github/workflows',
    (path) => files[path.split('/').pop()],
    () => Object.keys(files),
  );
  assert.deepEqual(result, []);
});

test('findMismatches returns only entries that differ from the expected version', () => {
  const entries = [
    { file: 'a.yml', version: '10.13.1' },
    { file: 'b.yml', version: '9.0.0' },
    { file: 'c.yml', version: '10.13.1' },
  ];
  assert.deepEqual(findMismatches('10.13.1', entries), [{ file: 'b.yml', version: '9.0.0' }]);
});

test('findMismatches returns an empty array when every entry matches', () => {
  const entries = [
    { file: 'a.yml', version: '10.13.1' },
    { file: 'b.yml', version: '10.13.1' },
  ];
  assert.deepEqual(findMismatches('10.13.1', entries), []);
});
