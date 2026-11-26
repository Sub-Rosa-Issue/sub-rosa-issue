import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNodeVersions } from './check-node-version.mjs';

const packageJson = JSON.stringify({ engines: { node: '>=22' } });
const workflow = `jobs:
  check:
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
`;

test('accepts Node 22 in the version file, engines, and every workflow', () => {
  assert.deepEqual(validateNodeVersions('22\n', packageJson, { 'check.yml': workflow }), []);
});

test('rejects a different version file or engine minimum', () => {
  const errors = validateNodeVersions('20\n', JSON.stringify({ engines: { node: '>=20' } }), {
    'check.yml': workflow,
  });
  assert.match(errors[0], /\.nvmrc must contain 22/);
  assert.match(errors[1], /engines\.node must be >=22/);
});

test('checks every setup-node step and reports missing versions', () => {
  const workflows = {
    'good.yml': workflow,
    'wrong.yml': workflow.replace("node-version: '22'", 'node-version: "20"'),
    'missing.yml': workflow.replace("node-version: '22'", 'cache: pnpm'),
  };
  const errors = validateNodeVersions('22\n', packageJson, workflows);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /wrong\.yml.*found "20"/);
  assert.match(errors[1], /missing\.yml.*found undefined/);
});

test('rejects a workflow without setup-node', () => {
  const errors = validateNodeVersions('22\n', packageJson, {
    'rust.yml': 'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@v4\n',
  });
  assert.deepEqual(errors, ['rust.yml: missing actions/setup-node']);
});
