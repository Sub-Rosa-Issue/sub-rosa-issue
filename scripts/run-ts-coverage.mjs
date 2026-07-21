#!/usr/bin/env node
/**
 * Collect Node.js test-runner line coverage across packages/* and services/*,
 * print a workspace summary, and fail when aggregate coverage is below threshold.
 *
 * Usage (repo root):
 *   node scripts/run-ts-coverage.mjs
 *   pnpm coverage:test
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(ROOT, "coverage.config.json");

function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return {
    lineThresholdPercent: Number(raw.lineThresholdPercent),
    workspaces: raw.workspaces,
  };
}

function testFilesForWorkspace(relPath) {
  const pkgPath = resolve(ROOT, relPath, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`Missing package.json: ${relPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const testScript = pkg.scripts?.test;
  if (!testScript) {
    throw new Error(`No test script in ${relPath}`);
  }
  const marker = "--test ";
  const idx = testScript.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Could not parse test script in ${relPath}: ${testScript}`);
  }
  return testScript.slice(idx + marker.length).trim().split(/\s+/);
}

function parseLineCoverage(output) {
  const match = output.match(/#\s+all files\s+\|\s+([\d.]+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function runWorkspaceCoverage(relPath) {
  const cwd = resolve(ROOT, relPath);
  const files = testFilesForWorkspace(relPath);
  const cmd = [
    "node",
    "--import",
    "tsx",
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/*.test.ts",
    "--test",
    ...files,
  ].join(" ");

  let output = "";
  try {
    output = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (error.status !== 0) {
      if (output) process.stderr.write(`${output}\n`);
      throw new Error(`Tests failed in ${relPath} (exit ${error.status})`);
    }
  }

  const linePercent = parseLineCoverage(output);
  if (linePercent == null) {
    throw new Error(`Coverage summary not found for ${relPath}`);
  }
  return linePercent;
}

function main() {
  const { lineThresholdPercent, workspaces } = loadConfig();

  console.log("Sub Rosa TypeScript coverage (packages/* + services/*)\n");
  console.log(
    `Configured minimum aggregate line coverage: ${lineThresholdPercent}%\n`,
  );

  const rows = [];
  for (const workspace of workspaces) {
    process.stdout.write(`Running coverage: ${workspace} ... `);
    const linePercent = runWorkspaceCoverage(workspace);
    rows.push({ workspace, linePercent });
    console.log(`${linePercent.toFixed(2)}% lines`);
  }

  const aggregate =
    rows.reduce((sum, row) => sum + row.linePercent, 0) / rows.length;

  console.log("\nCoverage summary");
  console.log("----------------");
  for (const row of rows) {
    console.log(`${row.workspace.padEnd(32)} ${row.linePercent.toFixed(2)}%`);
  }
  console.log("----------------");
  console.log(`${"aggregate (mean)".padEnd(32)} ${aggregate.toFixed(2)}%`);
  console.log(`threshold                        ${lineThresholdPercent.toFixed(2)}%`);

  if (aggregate < lineThresholdPercent) {
    console.error(
      `\n❌ Aggregate line coverage ${aggregate.toFixed(2)}% is below threshold ${lineThresholdPercent}%.`,
    );
    process.exit(1);
  }

  console.log("\n✅ Coverage gate passed.");
}

main();
