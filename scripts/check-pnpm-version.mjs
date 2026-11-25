#!/usr/bin/env node
/**
 * Verify every GitHub Actions workflow's `pnpm/action-setup` version matches
 * the root `package.json` `packageManager` field, so CI never silently runs
 * a different pnpm version than the one developers and lockfiles use.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from '../packages/logging/src/index.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const logger = createLogger('scripts.check-pnpm-version');
const WORKFLOWS_DIR = '.github/workflows';

/**
 * @param {string} packageJsonText
 * @returns {string} the pnpm version declared by `packageManager`, e.g. "10.13.1"
 */
export function parsePackageManagerVersion(packageJsonText) {
  const pkg = JSON.parse(packageJsonText);
  const packageManager = pkg.packageManager;
  if (typeof packageManager !== 'string') {
    throw new Error('package.json is missing a "packageManager" field');
  }
  const match = packageManager.match(/^pnpm@([0-9][0-9A-Za-z.+-]*)$/);
  if (!match) {
    throw new Error(`Unrecognized packageManager format: ${packageManager}`);
  }
  return match[1];
}

/**
 * @typedef {{ file: string, version: string }} WorkflowPnpmVersion
 * @param {string} workflowDir
 * @param {(path: string) => string} readFile
 * @param {(path: string) => string[]} listDir
 * @returns {WorkflowPnpmVersion[]}
 */
export function findWorkflowPnpmVersions(
  workflowDir,
  readFile = (path) => readFileSync(path, 'utf8'),
  listDir = (path) => readdirSync(path),
) {
  const results = [];
  for (const name of listDir(workflowDir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFile(join(workflowDir, name));
    const stepPattern = /uses:\s*pnpm\/action-setup@v\d+[\s\S]{0,120}?version:\s*["']?([^"'\s]+)["']?/g;
    for (const match of text.matchAll(stepPattern)) {
      results.push({ file: name, version: match[1] });
    }
  }
  return results;
}

/**
 * @param {string} expectedVersion
 * @param {WorkflowPnpmVersion[]} entries
 * @returns {WorkflowPnpmVersion[]}
 */
export function findMismatches(expectedVersion, entries) {
  return entries.filter((entry) => entry.version !== expectedVersion);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const expected = parsePackageManagerVersion(readFileSync(join(root, 'package.json'), 'utf8'));
  const entries = findWorkflowPnpmVersions(join(root, WORKFLOWS_DIR));
  const mismatches = findMismatches(expected, entries);

  if (entries.length === 0) {
    logger.error('pnpm-version-missing', 'No pnpm/action-setup steps found in .github/workflows', {
      workflowsDir: WORKFLOWS_DIR,
    });
    process.exitCode = 1;
  } else if (mismatches.length > 0) {
    logger.error(
      'pnpm-version-mismatch',
      `Workflow pnpm/action-setup version must match package.json packageManager (pnpm@${expected})`,
      { expected, mismatches },
    );
    process.exitCode = 1;
  } else {
    logger.info(
      'pnpm-version-check-passed',
      `All ${entries.length} workflow pnpm/action-setup version(s) match packageManager (pnpm@${expected})`,
    );
  }
}
