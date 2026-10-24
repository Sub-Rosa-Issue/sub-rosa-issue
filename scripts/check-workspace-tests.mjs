#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

const WORKSPACE_CONTAINERS = ["apps", "packages", "services"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", "target"]);
const TEST_FILE_REGEX = /\.test\.(?:c?js|m?js|tsx?)$/;

/**
 * Pre-existing test files on `main` that predated the workspace test exclusion
 * gate. New test files must be wired into their workspace's `scripts.test` (or
 * automatic test discovery).
 */
export const LEGACY_EXCLUDED_TESTS = new Set([
  "apps/web/src/components/AgentPanels.test.tsx",
  "apps/web/src/components/AttackDemo.test.tsx",
  "apps/web/src/components/DrandCountdownChip.test.tsx",
  "apps/web/src/components/LifecycleView.test.tsx",
  "apps/web/src/components/ObserverView.test.tsx",
  "apps/web/src/components/RoundStatusBadge.test.tsx",
  "apps/web/src/components/VerifiedSettlement.test.tsx",
  "apps/web/src/components/dashboard/KeeperStatusCard.test.tsx",
  "apps/web/src/components/dashboard/SettlementCard.test.tsx",
  "apps/web/src/config/routing.test.ts",
  "apps/web/src/dashboard/snapshot.test.ts",
  "apps/web/src/hooks/useRoundSession.network.test.tsx",
  "apps/web/src/lib/bytes-to-hex.test.ts",
  "apps/web/src/lib/chain.displayError.test.ts",
  "apps/web/src/lib/demo-action-gate.test.tsx",
  "apps/web/src/lib/demo-guards.test.ts",
  "apps/web/src/lib/format.test.ts",
  "apps/web/src/lib/network-guard.test.ts",
  "apps/web/src/lib/round-phase.test.ts",
  "apps/web/src/lib/use-reveal-phase.test.ts",
  "apps/web/src/pages/DemoPage.test.tsx",
  "packages/tlock/src/ciphertext.test.ts",
  "services/keeper/src/checkpoint-restart.test.ts",
  "services/keeper/src/checkpoint-startup.test.ts",
  "services/keeper/src/checkpoint.test.ts",
  "services/keeper/src/watch-lease.test.ts",
]);

export function listWorkspaceDirs(rootDir = DEFAULT_ROOT) {
  const workspaces = [];
  for (const container of WORKSPACE_CONTAINERS) {
    const absContainer = join(rootDir, container);
    if (!existsSync(absContainer)) continue;
    const entries = readdirSync(absContainer, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(absContainer, entry.name, "package.json");
      if (existsSync(pkgPath)) {
        workspaces.push(`${container}/${entry.name}`);
      }
    }
  }
  return workspaces;
}

export function listTestFilesInDir(dir, baseDir = dir, out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listTestFilesInDir(full, baseDir, out);
    } else if (entry.isFile() && TEST_FILE_REGEX.test(entry.name)) {
      out.push(relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Extract the set of relative test file paths referenced by a workspace's
 * `scripts.test` command, or `"*"` if the workspace uses a discovery script or glob.
 */
export function extractReferencedTests(testScript) {
  if (typeof testScript !== "string" || !testScript.trim()) {
    return new Set();
  }
  if (
    testScript.includes("run-tests.mjs") ||
    testScript.includes("**/*.test.") ||
    /\*\.test\./.test(testScript)
  ) {
    return "*";
  }

  const referenced = new Set();
  const tokens = testScript
    .split(/\s+|&&|\|\||;/)
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  for (const token of tokens) {
    if (TEST_FILE_REGEX.test(token)) {
      referenced.add(token.replace(/^\.\//, "").replace(/\\/g, "/"));
    }
  }
  return referenced;
}

export function findOrphanedWorkspaceTests(
  rootDir = DEFAULT_ROOT,
  options = {},
) {
  const allowLegacy = options.allowLegacy ?? rootDir === DEFAULT_ROOT;
  const orphaned = [];

  for (const ws of listWorkspaceDirs(rootDir)) {
    const wsAbs = join(rootDir, ws);
    const pkg = JSON.parse(readFileSync(join(wsAbs, "package.json"), "utf8"));
    const referenced = extractReferencedTests(pkg.scripts?.test ?? "");
    if (referenced === "*") continue;

    const filesOnDisk = listTestFilesInDir(wsAbs);
    for (const relFile of filesOnDisk) {
      const repoRel = `${ws}/${relFile}`;
      if (referenced.has(relFile)) continue;
      if (allowLegacy && LEGACY_EXCLUDED_TESTS.has(repoRel)) continue;
      orphaned.push(repoRel);
    }
  }

  return orphaned;
}

function main() {
  const args = process.argv.slice(2);
  let rootDir = DEFAULT_ROOT;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strict") {
      strict = true;
    } else if (args[i] === "--root" && i + 1 < args.length) {
      rootDir = resolve(args[i + 1]);
      i++;
    }
  }

  const orphaned = findOrphanedWorkspaceTests(rootDir, {
    allowLegacy: !strict && rootDir === DEFAULT_ROOT,
  });

  if (orphaned.length > 0) {
    for (const file of orphaned) {
      process.stdout.write(`${file}\n`);
    }
    process.stderr.write(
      `❌ Found ${orphaned.length} orphaned test file(s) excluded from workspace package.json test scripts.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    "✅ All workspace test files are accounted for in package.json test scripts.\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
