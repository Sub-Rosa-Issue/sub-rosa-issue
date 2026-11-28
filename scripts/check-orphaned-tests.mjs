#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

const WORKSPACE_CONTAINERS = ["apps", "packages", "services"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", "target"]);
const TEST_FILE_REGEX = /\.test\.(?:[cm]?js|tsx?)$/;

/**
 * Intentionally excluded workspace test files. Each entry must stay present on
 * disk and absent from that workspace's `package.json` `"test"` script.
 * New `*.test.*` files must be wired into `scripts.test` or documented here.
 */
export const DOCUMENTED_EXCLUSIONS = Object.freeze({
  "apps/web/src/components/AgentPanels.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/AttackDemo.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/DrandCountdownChip.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/LifecycleView.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/ObserverView.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/RoundStatusBadge.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/VerifiedSettlement.test.tsx":
    "React component suite run outside the default node --test script",
  "apps/web/src/components/dashboard/KeeperStatusCard.test.tsx":
    "Dashboard component suite run outside the default node --test script",
  "apps/web/src/components/dashboard/SettlementCard.test.tsx":
    "Dashboard component suite run outside the default node --test script",
  "apps/web/src/config/routing.test.ts":
    "Router suite run outside the default node --test script",
  "apps/web/src/dashboard/snapshot.test.ts":
    "Dashboard snapshot suite run outside the default node --test script",
  "apps/web/src/demo/demo-a11y-smoke.test.tsx":
    "Demo accessibility smoke suite run outside the default node --test script",
  "apps/web/src/hooks/useRoundSession.network.test.tsx":
    "Hook network-switch suite run outside the default node --test script",
  "apps/web/src/lib/bytes-to-hex.test.ts":
    "Legacy hex helper suite superseded by src/lib/hex.test.ts",
  "apps/web/src/lib/chain.displayError.test.ts":
    "Display-error helper suite run outside the default node --test script",
  "apps/web/src/lib/demo-action-gate.test.tsx":
    "Demo action gate suite run outside the default node --test script",
  "apps/web/src/lib/demo-guards.test.ts":
    "Demo guard suite run outside the default node --test script",
  "apps/web/src/lib/format.test.ts":
    "Formatting helper suite run outside the default node --test script",
  "apps/web/src/lib/network-guard.test.ts":
    "Network guard suite run outside the default node --test script",
  "apps/web/src/lib/round-phase.test.ts":
    "Round phase helper suite run outside the default node --test script",
  "apps/web/src/lib/use-reveal-phase.test.ts":
    "Reveal phase hook suite run outside the default node --test script",
  "apps/web/src/pages/DemoPage.test.tsx":
    "Demo page integration suite run outside the default node --test script",
  "apps/web/src/skip-link-landmarks.test.tsx":
    "Landmark accessibility suite run outside the default node --test script",
  "packages/tlock/src/ciphertext.test.ts":
    "ContractId-bound seal fixture harness outside the default unit runner",
  "services/keeper/src/checkpoint-restart.test.ts":
    "Restart harness exercised separately from the default unit suite",
  "services/keeper/src/checkpoint-startup.test.ts":
    "Startup reconciliation harness exercised separately from the default unit suite",
  "services/keeper/src/checkpoint.test.ts":
    "Checkpoint harness exercised separately from the default unit suite",
  "services/keeper/src/watch-lease.test.ts":
    "Lease contention harness exercised separately from the default unit suite",
});

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
      if (existsSync(join(absContainer, entry.name, "package.json"))) {
        workspaces.push(`${container}/${entry.name}`);
      }
    }
  }
  return workspaces;
}

function walkTestFiles(dir, baseDir = dir, out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, baseDir, out);
    } else if (entry.isFile() && TEST_FILE_REGEX.test(entry.name)) {
      out.push(relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Prefer git-tracked workspace test files when the root is a git checkout;
 * fall back to a filesystem walk (temp fixtures, non-git trees).
 */
export function listWorkspaceTestFiles(wsRel, rootDir = DEFAULT_ROOT) {
  const wsAbs = join(rootDir, wsRel);
  const tracked = listTrackedTestFiles(rootDir, wsRel);
  if (tracked !== null) return tracked;
  return walkTestFiles(wsAbs);
}

function listTrackedTestFiles(rootDir, wsRel) {
  const gitDir = join(rootDir, ".git");
  if (!existsSync(gitDir)) return null;
  const result = spawnSync(
    "git",
    ["-C", rootDir, "ls-files", "--", `${wsRel}/**/*.test.*`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  const files = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\\/g, "/");
    if (!trimmed) continue;
    const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    if (!TEST_FILE_REGEX.test(base)) continue;
    if (!trimmed.startsWith(`${wsRel}/`)) continue;
    files.push(trimmed.slice(wsRel.length + 1));
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files;
}

/**
 * Paths referenced by a workspace `scripts.test` command, or `"*"` when the
 * script uses a discovery runner / glob that covers every matching file.
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
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  for (const token of tokens) {
    if (TEST_FILE_REGEX.test(token)) {
      referenced.add(token.replace(/^\.\//, "").replace(/\\/g, "/"));
    }
  }
  return referenced;
}

/**
 * Compare tracked (or on-disk) workspace test files with each workspace's
 * `scripts.test` discovery and report orphaned / stale exclusion issues.
 */
export function findOrphanedWorkspaceTests(
  rootDir = DEFAULT_ROOT,
  { documentedExclusions = DOCUMENTED_EXCLUSIONS } = {},
) {
  const issues = [];
  const discovered = new Set();

  for (const ws of listWorkspaceDirs(rootDir)) {
    const wsAbs = join(rootDir, ws);
    const pkg = JSON.parse(readFileSync(join(wsAbs, "package.json"), "utf8"));
    const referenced = extractReferencedTests(pkg.scripts?.test ?? "");
    const files = listWorkspaceTestFiles(ws, rootDir);

    for (const relFile of files) {
      const repoRel = `${ws}/${relFile}`;
      discovered.add(repoRel);
      const exclusion = documentedExclusions[repoRel];
      const documented =
        typeof exclusion === "string" && exclusion.trim().length > 0;

      if (referenced === "*") {
        if (documented) {
          issues.push(
            `${repoRel} is covered by test discovery; remove its stale DOCUMENTED_EXCLUSIONS entry`,
          );
        }
        continue;
      }

      const inScript = referenced.has(relFile);
      if (!inScript && !documented) {
        issues.push(
          `${repoRel} is excluded from package.json "test" and is not listed in DOCUMENTED_EXCLUSIONS`,
        );
      } else if (inScript && documented) {
        issues.push(
          `${repoRel} is included in package.json "test"; remove its stale DOCUMENTED_EXCLUSIONS entry`,
        );
      }
    }

    if (referenced !== "*") {
      for (const scriptFile of referenced) {
        if (!existsSync(join(wsAbs, scriptFile))) {
          issues.push(
            `${ws} package.json "test" references missing file ${ws}/${scriptFile}`,
          );
        }
      }
    }
  }

  for (const [path, reason] of Object.entries(documentedExclusions)) {
    if (typeof reason !== "string" || !reason.trim()) {
      issues.push(`DOCUMENTED_EXCLUSIONS entry ${path} needs a non-empty reason`);
    }
    if (!discovered.has(path)) {
      issues.push(`DOCUMENTED_EXCLUSIONS lists ${path}, which is not a tracked workspace test file`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  let rootDir = DEFAULT_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && i + 1 < args.length) {
      rootDir = resolve(args[++i]);
    }
  }

  const result = findOrphanedWorkspaceTests(rootDir);
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`❌ ${issue}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    "✅ All workspace test files are covered by package.json test scripts or documented exclusions.\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
