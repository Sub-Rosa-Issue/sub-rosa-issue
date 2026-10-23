// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const FULL_SHA = /^[0-9a-f]{40}$/;
const ACTION_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const USES_LINE = /^\s*(?:-\s+)?uses\s*:\s*(\S+)\s*(?:#\s*(.*))?$/;
const PERMISSIONS_LINE = /^(\s*)permissions\s*:\s*(.*)$/;
const PERMISSION_ENTRY = /^\s*([A-Za-z0-9_-]+)\s*:\s*(\S+)/;

/**
 * Load and validate .github/actions-allowlist.json.
 *
 * The file maps each reviewed action to the full-length commit SHAs this
 * repository is allowed to run, labeled with the upstream release they come
 * from so reviewers can see what a pin means.
 */
function loadAllowlist(file) {
  const errors = [];
  const allowed = new Map();

  if (!existsSync(file)) {
    return { allowed, errors: [`${file}: allowlist file is missing`] };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { allowed, errors: [`${file}: invalid JSON (${error.message})`] };
  }

  const actions = data?.actions;
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
    return { allowed, errors: [`${file}: expected an "actions" object`] };
  }

  for (const [action, pins] of Object.entries(actions)) {
    if (!ACTION_ID.test(action)) {
      errors.push(`${file}: "${action}" is not an owner/repo action id`);
      continue;
    }

    const key = action.toLowerCase();
    if (allowed.has(key)) {
      errors.push(`${file}: "${action}" is listed more than once`);
      continue;
    }

    if (!pins || typeof pins !== 'object' || Array.isArray(pins) || Object.keys(pins).length === 0) {
      errors.push(`${file}: "${action}" must list at least one pinned commit SHA`);
      continue;
    }

    const bySha = new Map();
    for (const [sha, version] of Object.entries(pins)) {
      if (!FULL_SHA.test(sha)) {
        errors.push(`${file}: "${action}" pin "${sha}" is not a full-length lowercase commit SHA`);
        continue;
      }
      if (typeof version !== 'string' || version.trim() === '') {
        errors.push(`${file}: "${action}@${sha}" needs a reviewed version label (for example "v4.4.0")`);
      }
      bySha.set(sha, version);
    }

    allowed.set(key, { action, pins: bySha });
  }

  return { allowed, errors };
}

/** Return the workflow files under .github/workflows, sorted by name. */
function listWorkflowFiles(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { files: [], error: `${dir}: workflows directory is missing` };
  }

  const files = readdirSync(dir)
    .filter((name) => WORKFLOW_EXTENSIONS.has(extname(name).toLowerCase()))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();

  return { files: files.map((name) => join(dir, name)), error: null };
}

/** Flag any workflow permission that is not read-only. */
function checkPermissions(lines, file, errors) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(PERMISSIONS_LINE);
    if (!match) continue;

    const indent = match[1].length;
    const inline = match[2].trim();
    const isBlock = inline === '' || inline.startsWith('#');

    if (!isBlock) {
      if (inline.includes('write')) {
        errors.push(`${file}:${index + 1}: permissions must stay read-only (found "${inline}")`);
      }
      continue;
    }

    // Walk the block children: anything indented deeper than `permissions:`.
    for (let child = index + 1; child < lines.length; child += 1) {
      const text = lines[child];
      if (text.trim() === '' || text.trim().startsWith('#')) continue;

      const childIndent = text.match(/^\s*/)[0].length;
      if (childIndent <= indent) break;

      const entry = text.match(PERMISSION_ENTRY);
      if (entry && entry[2] === 'write') {
        errors.push(`${file}:${child + 1}: "${entry[1]}: write" broadens workflow token permissions`);
      }
    }
  }
}

/** Verify every `uses:` in a workflow is an allowlisted, SHA-pinned action. */
function checkWorkflow(file, root, allowed, used, errors) {
  const relPath = relative(root, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(USES_LINE);
    if (!match) continue;

    const reference = match[1];
    const location = `${relPath}:${index + 1}`;

    // Local composite actions live in this repository and are reviewed here.
    if (reference.startsWith('./')) continue;

    if (reference.startsWith('docker://')) {
      errors.push(`${location}: "${reference}" cannot be pinned by commit SHA; use a reviewed action instead`);
      continue;
    }

    const separator = reference.lastIndexOf('@');
    if (separator === -1) {
      errors.push(`${location}: "${reference}" has no ref; pin it as owner/repo@<40-character SHA>`);
      continue;
    }

    const action = reference.slice(0, separator);
    const ref = reference.slice(separator + 1);

    if (!ACTION_ID.test(action)) {
      errors.push(`${location}: "${action}" is not an owner/repo action id`);
      continue;
    }

    if (!FULL_SHA.test(ref)) {
      const hint = /^v?\d/.test(ref) ? ` (tag "${ref}" is mutable)` : '';
      errors.push(`${location}: "${reference}" is not pinned to a full-length commit SHA${hint}`);
      continue;
    }

    const entry = allowed.get(action.toLowerCase());
    if (!entry) {
      errors.push(`${location}: action "${action}" is not in .github/actions-allowlist.json`);
      continue;
    }

    if (!entry.pins.has(ref)) {
      const known = [...entry.pins.keys()].join(', ');
      errors.push(`${location}: "${action}@${ref}" is not an allowlisted pin (reviewed: ${known})`);
      continue;
    }

    used.add(`${action.toLowerCase()}@${ref}`);
  }

  checkPermissions(lines, relPath, errors);
}

/** Run every check against a repository root and return the violations found. */
export function checkRepository(root) {
  const errors = [];
  const { allowed, errors: allowlistErrors } = loadAllowlist(
    join(root, '.github', 'actions-allowlist.json'),
  );
  errors.push(...allowlistErrors);

  const { files, error } = listWorkflowFiles(root);
  if (error) errors.push(error);
  if (files.length === 0 && !error) {
    errors.push(`${join(root, '.github', 'workflows')}: no workflow files found`);
  }

  const used = new Set();
  for (const file of files) {
    checkWorkflow(file, root, allowed, used, errors);
  }

  // An unused entry silently widens the allowlist beyond what is reviewed.
  for (const [key, entry] of allowed) {
    for (const [sha, version] of entry.pins) {
      if (!used.has(`${key}@${sha}`)) {
        errors.push(
          `.github/actions-allowlist.json: unused entry "${entry.action}@${sha}" (${version}); remove it or reference it`,
        );
      }
    }
  }

  return { errors, workflowCount: files.length, actionCount: used.size };
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' && index + 1 < argv.length) {
      root = resolve(argv[index + 1]);
      index += 1;
    } else {
      console.error(`Unknown argument: ${argv[index]}`);
      process.exitCode = 2;
      return null;
    }
  }
  return { root };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;

  const { errors, workflowCount, actionCount } = checkRepository(args.root);

  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    console.error(
      `❌ ${errors.length} GitHub Actions policy violation(s). Pin every action to an allowlisted full-length SHA in .github/actions-allowlist.json.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `✅ ${actionCount} allowlisted action pin(s) across ${workflowCount} workflow(s) verified.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
