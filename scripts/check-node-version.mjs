#!/usr/bin/env node
/**
 * Verify that `.nvmrc`, `.node-version`, root `package.json` `engines.node`,
 * and every GitHub Actions workflow's `actions/setup-node` step declare the
 * same Node.js major version (currently 22).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from '../packages/logging/src/index.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const logger = createLogger('scripts.check-node-version');
const WORKFLOWS_DIR = '.github/workflows';
export const VERSION_FILES = ['.nvmrc', '.node-version'];

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {string}
 */
export function parseNodeVersionFile(text, fileName = '.nvmrc') {
  const trimmed = (text ?? '').trim().replace(/^v/i, '');
  const match = trimmed.match(/^([0-9]+)(?:\.[0-9]+(?:\.[0-9]+)?)?$/);
  if (!match) {
    throw new Error(`Invalid Node version in ${fileName}: ${JSON.stringify(text)}`);
  }
  return match[1];
}

/**
 * @param {string} packageJsonText
 * @returns {string}
 */
export function parseEnginesNodeMajor(packageJsonText) {
  const pkg = JSON.parse(packageJsonText);
  const nodeRange = pkg?.engines?.node;
  if (typeof nodeRange !== 'string' || !nodeRange.trim()) {
    throw new Error('package.json is missing an "engines.node" field');
  }
  const match = nodeRange.trim().match(/^(?:>=|\^|~|=)?\s*v?([0-9]+)(?:\.[0-9x*]+)*$/i);
  if (!match) {
    throw new Error(`Unrecognized engines.node format: ${nodeRange}`);
  }
  return match[1];
}

/**
 * @typedef {{ file: string, version: string }} WorkflowNodeVersion
 * @param {string} workflowDir
 * @param {(path: string) => string} readFile
 * @param {(path: string) => string[]} listDir
 * @returns {WorkflowNodeVersion[]}
 */
export function findWorkflowNodeVersions(
  workflowDir,
  readFile = (path) => readFileSync(path, 'utf8'),
  listDir = (path) => readdirSync(path),
) {
  const results = [];
  for (const name of listDir(workflowDir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFile(join(workflowDir, name));
    const stepPattern =
      /uses:\s*actions\/setup-node@v\d+[\s\S]{0,160}?node-version:\s*["']?v?([0-9]+)(?:\.[0-9x*]+)*["']?/g;
    for (const match of text.matchAll(stepPattern)) {
      results.push({ file: name, version: match[1] });
    }
  }
  return results;
}

/**
 * @param {string} expectedMajor
 * @param {WorkflowNodeVersion[]} entries
 * @returns {WorkflowNodeVersion[]}
 */
export function findMismatches(expectedMajor, entries) {
  return entries.filter((entry) => entry.version !== expectedMajor);
}

/**
 * @param {string} [rootDir]
 */
export function validateNodeVersionAlignment(rootDir = root) {
  const expectedMajor = parseEnginesNodeMajor(
    readFileSync(join(rootDir, 'package.json'), 'utf8'),
  );
  const fileEntries = [];
  for (const vf of VERSION_FILES) {
    const absPath = join(rootDir, vf);
    if (!existsSync(absPath)) {
      throw new Error(`Missing Node version file: ${vf}`);
    }
    const ver = parseNodeVersionFile(readFileSync(absPath, 'utf8'), vf);
    fileEntries.push({ file: vf, version: ver });
  }
  const workflowEntries = findWorkflowNodeVersions(join(rootDir, WORKFLOWS_DIR));
  const allEntries = [...fileEntries, ...workflowEntries];
  const mismatches = findMismatches(expectedMajor, allEntries);
  return {
    expectedMajor,
    fileEntries,
    workflowEntries,
    mismatches,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { expectedMajor, workflowEntries, mismatches } =
      validateNodeVersionAlignment(root);
    if (workflowEntries.length === 0) {
      logger.error(
        'node-version-missing',
        'No actions/setup-node steps found in .github/workflows',
        { workflowsDir: WORKFLOWS_DIR },
      );
      process.exitCode = 1;
    } else if (mismatches.length > 0) {
      logger.error(
        'node-version-mismatch',
        `Node version files and workflow actions/setup-node steps must match package.json engines.node (Node ${expectedMajor})`,
        { expectedMajor, mismatches },
      );
      process.exitCode = 1;
    } else {
      logger.info(
        'node-version-check-passed',
        `.nvmrc, .node-version, and all ${workflowEntries.length} workflow actions/setup-node step(s) match engines.node (Node ${expectedMajor})`,
      );
    }
  } catch (err) {
    logger.error('node-version-error', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
