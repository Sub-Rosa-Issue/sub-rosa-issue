// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const CHECKER = fileURLToPath(new URL('check-actions-policy.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';

/** Run the checker against a root and report output without throwing on failure. */
function runChecker(root) {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, '--root', root], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/** Write a throwaway repository with workflow files and an allowlist. */
function createProject({ workflows, allowlist }) {
  const root = mkdtempSync(join(tmpdir(), 'actions-policy-'));
  for (const [path, content] of Object.entries(workflows)) {
    const fullPath = join(root, '.github', 'workflows', path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  if (allowlist !== null) {
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(
      join(root, '.github', 'actions-allowlist.json'),
      typeof allowlist === 'string' ? allowlist : JSON.stringify(allowlist, null, 2),
    );
  }
  return root;
}

function defaultAllowlist(pins = { [CHECKOUT_SHA]: 'v4.4.0' }) {
  return { actions: { 'actions/checkout': pins } };
}

function workflowStep(reference, extra = '') {
  return `name: Test\non: push\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${reference}\n${extra}`;
}

function withProject(options, assertions) {
  const root = createProject(options);
  try {
    assertions(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-actions-policy', () => {
  it('passes on the real repository', () => {
    const { code, stdout } = runChecker(REPO_ROOT);
    assert.equal(code, 0, 'repository workflows must satisfy the policy');
    assert.match(stdout, /allowlisted action pin\(s\) across \d+ workflow\(s\) verified/);
  });

  it('accepts an allowlisted action pinned to a full-length SHA with a version comment', () => {
    withProject(
      {
        workflows: { 'ci.yml': workflowStep(`actions/checkout@${CHECKOUT_SHA} # v4.4.0`) },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stdout } = runChecker(root);
        assert.equal(code, 0);
        assert.match(stdout, /1 allowlisted action pin\(s\) across 1 workflow\(s\)/);
      },
    );
  });

  it('rejects a mutable major-version tag', () => {
    withProject(
      { workflows: { 'ci.yml': workflowStep('actions/checkout@v4') }, allowlist: defaultAllowlist() },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /ci\.yml:9:.*not pinned to a full-length commit SHA/);
      },
    );
  });

  it('rejects an abbreviated commit SHA', () => {
    withProject(
      {
        workflows: { 'ci.yml': workflowStep('actions/checkout@11d5960') },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /not pinned to a full-length commit SHA/);
      },
    );
  });

  it('rejects an action missing from the allowlist', () => {
    withProject(
      {
        workflows: {
          'ci.yml': workflowStep('untrusted/action@0123456789abcdef0123456789abcdef01234567'),
        },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /"untrusted\/action" is not in \.github\/actions-allowlist\.json/);
      },
    );
  });

  it('rejects a SHA that is pinned but not reviewed for an allowlisted action', () => {
    withProject(
      {
        workflows: {
          'ci.yml': workflowStep('actions/checkout@0123456789abcdef0123456789abcdef01234567'),
        },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /is not an allowlisted pin \(reviewed: 11d5960/);
      },
    );
  });

  it('rejects allowlist entries that no workflow uses', () => {
    withProject(
      {
        workflows: { 'ci.yml': workflowStep(`actions/checkout@${CHECKOUT_SHA}`) },
        allowlist: {
          actions: {
            'actions/checkout': { [CHECKOUT_SHA]: 'v4.4.0' },
            'actions/setup-node': { '49933ea5288caeca8642d1e84afbd3f7d6820020': 'v4.4.0' },
          },
        },
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /unused entry "actions\/setup-node@49933ea/);
      },
    );
  });

  it('allows local composite actions and ignores commented-out entries', () => {
    withProject(
      {
        workflows: {
          'ci.yml': `${workflowStep(`actions/checkout@${CHECKOUT_SHA}`)}\n      # - uses: actions/checkout@v4\n      - uses: ./.github/actions/local\n`,
        },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.equal(code, 0, stderr);
      },
    );
  });

  it('rejects docker:// actions that cannot be SHA pinned', () => {
    withProject(
      {
        workflows: { 'ci.yml': workflowStep('docker://alpine:3.20') },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /cannot be pinned by commit SHA/);
      },
    );
  });

  it('rejects write permissions at workflow and job level', () => {
    withProject(
      {
        workflows: {
          'ci.yml': `name: Test\non: push\npermissions:\n  contents: write\njobs:\n  test:\n    runs-on: ubuntu-latest\n    permissions:\n      pull-requests: write\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n`,
        },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /ci\.yml:4: "contents: write" broadens workflow token permissions/);
        assert.match(
          stderr,
          /ci\.yml:9: "pull-requests: write" broadens workflow token permissions/,
        );
      },
    );
  });

  it('scans .yaml workflow files as well as .yml', () => {
    withProject(
      {
        workflows: { 'ci.yaml': workflowStep(`actions/checkout@${CHECKOUT_SHA}`) },
        allowlist: defaultAllowlist(),
      },
      (root) => {
        const { code, stdout } = runChecker(root);
        assert.equal(code, 0);
        assert.match(stdout, /across 1 workflow\(s\)/);
      },
    );
  });

  it('keeps the documented allowlist in sync with the reviewed allowlist', () => {
    const allowlist = JSON.parse(
      readFileSync(join(REPO_ROOT, '.github', 'actions-allowlist.json'), 'utf8'),
    );
    const docs = readFileSync(join(REPO_ROOT, 'docs', 'CI.md'), 'utf8');

    for (const [action, pins] of Object.entries(allowlist.actions)) {
      for (const [sha, version] of Object.entries(pins)) {
        assert.ok(docs.includes(action), `docs/CI.md must list ${action}`);
        assert.ok(docs.includes(sha), `docs/CI.md must list the ${action} pin ${sha}`);
        assert.ok(docs.includes(version), `docs/CI.md must list the ${action} version ${version}`);
      }
    }
  });

  it('fails when the allowlist is missing or malformed', () => {
    withProject(
      {
        workflows: { 'ci.yml': workflowStep(`actions/checkout@${CHECKOUT_SHA}`) },
        allowlist: null,
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /allowlist file is missing/);
      },
    );

    withProject(
      {
        workflows: { 'ci.yml': workflowStep(`actions/checkout@${CHECKOUT_SHA}`) },
        allowlist: '{ "actions": ',
      },
      (root) => {
        const { code, stderr } = runChecker(root);
        assert.notEqual(code, 0);
        assert.match(stderr, /invalid JSON/);
      },
    );
  });
});
