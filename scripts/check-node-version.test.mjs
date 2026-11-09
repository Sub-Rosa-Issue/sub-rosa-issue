import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNodeVersionFile,
  parseEnginesNodeMajor,
  findWorkflowNodeVersions,
  findMismatches,
  validateNodeVersionAlignment,
} from './check-node-version.mjs';

test('parseNodeVersionFile extracts the major version from .nvmrc / .node-version', () => {
  assert.equal(parseNodeVersionFile('22\n', '.nvmrc'), '22');
  assert.equal(parseNodeVersionFile('v22.11.0\n', '.node-version'), '22');
});

test('parseNodeVersionFile throws on empty or invalid content', () => {
  assert.throws(() => parseNodeVersionFile('', '.nvmrc'), /Invalid Node version/);
  assert.throws(() => parseNodeVersionFile('lts/*', '.nvmrc'), /Invalid Node version/);
});

test('parseEnginesNodeMajor extracts the major version from package.json engines.node', () => {
  assert.equal(
    parseEnginesNodeMajor(JSON.stringify({ engines: { node: '>=22' } })),
    '22',
  );
  assert.equal(
    parseEnginesNodeMajor(JSON.stringify({ engines: { node: '22.x' } })),
    '22',
  );
});

test('parseEnginesNodeMajor throws when engines.node is missing or malformed', () => {
  assert.throws(() => parseEnginesNodeMajor(JSON.stringify({})), /missing/);
  assert.throws(
    () => parseEnginesNodeMajor(JSON.stringify({ engines: { node: 'latest' } })),
    /Unrecognized engines\.node format/,
  );
});

test('findWorkflowNodeVersions reads the node-version from each workflow file', () => {
  const files = {
    'a.yml': [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: "22"',
    ].join('\n'),
    'b.yml': [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/setup-node@v4',
      '        with:',
      "          node-version: '20'",
    ].join('\n'),
    'notes.txt': 'ignored',
  };
  const result = findWorkflowNodeVersions(
    '.github/workflows',
    (path) => files[path.split(/[\\/]/).pop()],
    () => Object.keys(files),
  );
  assert.deepEqual(result, [
    { file: 'a.yml', version: '22' },
    { file: 'b.yml', version: '20' },
  ]);
});

test('findMismatches returns only entries that differ from the expected major version', () => {
  const entries = [
    { file: '.nvmrc', version: '22' },
    { file: 'a.yml', version: '22' },
    { file: 'b.yml', version: '20' },
  ];
  assert.deepEqual(findMismatches('22', entries), [{ file: 'b.yml', version: '20' }]);
});

test('validateNodeVersionAlignment passes against the repository root', () => {
  const res = validateNodeVersionAlignment();
  assert.equal(res.expectedMajor, '22');
  assert.equal(res.fileEntries.length, 2);
  assert.ok(res.workflowEntries.length > 0);
  assert.deepEqual(res.mismatches, []);
});
