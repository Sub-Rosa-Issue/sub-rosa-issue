#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

/**
 * Deterministic ordered list of maintained workspaces that expose a `test` script.
 */
export const TEST_WORKSPACES = [
  "@sub-rosa/logging",
  "@sub-rosa/time",
  "@sub-rosa/round-bindings",
  "@sub-rosa/tlock",
  "@sub-rosa/sdk",
  "@sub-rosa/drand-tools",
  "@sub-rosa/keeper",
  "@sub-rosa/receipt-cli",
  "@sub-rosa/appraisal-api",
  "@sub-rosa/agent",
  "@sub-rosa/auction-template",
  "@sub-rosa/web",
];

/**
 * Deterministic ordered list of maintained TypeScript workspaces that expose a `typecheck` script.
 */
export const TYPECHECK_WORKSPACES = [
  "@sub-rosa/time",
  "@sub-rosa/round-bindings",
  "@sub-rosa/tlock",
  "@sub-rosa/sdk",
  "@sub-rosa/drand-tools",
  "@sub-rosa/keeper",
  "@sub-rosa/receipt-cli",
  "@sub-rosa/appraisal-api",
  "@sub-rosa/agent",
  "@sub-rosa/auction-template",
  "@sub-rosa/web",
];

const WORKSPACE_CONTAINERS = ["packages", "services", "apps"];

export function discoverWorkspacesWithScript(scriptName, rootDir = DEFAULT_ROOT) {
  const found = [];
  for (const container of WORKSPACE_CONTAINERS) {
    const absContainer = join(rootDir, container);
    if (!existsSync(absContainer)) continue;
    const entries = readdirSync(absContainer, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(absContainer, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name && pkg.scripts?.[scriptName]) {
        found.push(pkg.name);
      }
    }
  }
  return found;
}

export function verifyAggregateCoverage(
  rootDir = DEFAULT_ROOT,
  {
    testWorkspaces = TEST_WORKSPACES,
    typecheckWorkspaces = TYPECHECK_WORKSPACES,
  } = {},
) {
  const issues = [];
  const actualTests = discoverWorkspacesWithScript("test", rootDir);
  const actualTypechecks = discoverWorkspacesWithScript("typecheck", rootDir);

  for (const ws of actualTests) {
    if (!testWorkspaces.includes(ws)) {
      issues.push(`Workspace ${ws} has a "test" script but is missing from TEST_WORKSPACES`);
    }
  }
  for (const ws of testWorkspaces) {
    if (!actualTests.includes(ws)) {
      issues.push(`TEST_WORKSPACES lists ${ws}, which does not define a "test" script`);
    }
  }

  for (const ws of actualTypechecks) {
    if (!typecheckWorkspaces.includes(ws)) {
      issues.push(
        `Workspace ${ws} has a "typecheck" script but is missing from TYPECHECK_WORKSPACES`,
      );
    }
  }
  for (const ws of typecheckWorkspaces) {
    if (!actualTypechecks.includes(ws)) {
      issues.push(
        `TYPECHECK_WORKSPACES lists ${ws}, which does not define a "typecheck" script`,
      );
    }
  }

  const rootPkgPath = join(rootDir, "package.json");
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
    if (!rootPkg.scripts?.test) {
      issues.push('Root package.json is missing aggregate "test" script');
    }
    if (!rootPkg.scripts?.typecheck) {
      issues.push('Root package.json is missing aggregate "typecheck" script');
    }
  } else {
    issues.push("Missing root package.json");
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const res = verifyAggregateCoverage(DEFAULT_ROOT);
    if (!res.ok) {
      for (const issue of res.issues) {
        process.stderr.write(`❌ ${issue}\n`);
      }
      process.exit(1);
    }
    process.stdout.write(
      `✅ Root aggregate test (${TEST_WORKSPACES.length}) and typecheck (${TYPECHECK_WORKSPACES.length}) workspace lists are complete.\n`,
    );
    return;
  }

  const mode = args[0];
  if (mode !== "test" && mode !== "typecheck") {
    process.stderr.write(
      "Usage: node scripts/run-workspace-checks.mjs <test|typecheck|--check>\n",
    );
    process.exit(1);
  }

  const list = mode === "test" ? TEST_WORKSPACES : TYPECHECK_WORKSPACES;
  for (const ws of list) {
    process.stdout.write(`\n▶ pnpm --filter ${ws} ${mode}\n`);
    const res = spawnSync("pnpm", ["--filter", ws, mode], {
      cwd: DEFAULT_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if ((res.status ?? 1) !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
