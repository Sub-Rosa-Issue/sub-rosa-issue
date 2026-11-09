#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

const WORKSPACE_CONTAINERS = ["packages", "services", "apps"];
const TEST_FILE_PATTERN = /\.test\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

/**
 * Explicitly documented test files that are intentionally excluded from their
 * workspace's default `package.json` `"test"` script (for example, component/DOM
 * suites or cross-module integration harnesses that require dedicated fixtures
 * or browser/happy-dom runners).
 *
 * Adding a new `*.test.*` file to a workspace without either wiring it into
 * `package.json` `"test"` or documenting an intentional exclusion here causes
 * `check-test-discovery.mjs` to fail.
 */
export const DOCUMENTED_EXCLUDED_TEST_FILES = Object.freeze({
  "packages/tlock/src/ciphertext.test.ts":
    "Requires contractId-bound seal fixture setup outside the default unit runner",
  "services/keeper/src/checkpoint-restart.test.ts":
    "Integration restart harness exercised separately from default unit suite",
  "services/keeper/src/checkpoint-startup.test.ts":
    "Startup reconciliation harness exercised separately from default unit suite",
  "services/keeper/src/watch-lease.test.ts":
    "Multi-watcher lease contention harness exercised separately from default unit suite",
  "apps/web/src/skip-link-landmarks.test.tsx":
    "DOM landmark accessibility suite run outside default node --test script",
  "apps/web/src/components/AgentPanels.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/AttackDemo.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/DrandCountdownChip.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/LifecycleView.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/ObserverView.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/RoundStatusBadge.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/VerifiedSettlement.test.tsx":
    "React component rendering suite excluded from default node --test script",
  "apps/web/src/components/dashboard/KeeperStatusCard.test.tsx":
    "Dashboard component suite excluded from default node --test script",
  "apps/web/src/components/dashboard/SettlementCard.test.tsx":
    "Dashboard component suite excluded from default node --test script",
  "apps/web/src/config/routing.test.ts":
    "Router navigation suite excluded from default node --test script",
  "apps/web/src/dashboard/snapshot.test.ts":
    "Dashboard snapshot suite excluded from default node --test script",
  "apps/web/src/demo/demo-a11y-smoke.test.tsx":
    "Demo accessibility smoke suite excluded from default node --test script",
  "apps/web/src/hooks/useRoundSession.network.test.tsx":
    "Hook network-switch suite excluded from default node --test script",
  "apps/web/src/lib/bytes-to-hex.test.ts":
    "Legacy hex helper suite superseded by src/lib/hex.test.ts",
  "apps/web/src/lib/chain.displayError.test.ts":
    "Display-error helper suite excluded from default node --test script",
  "apps/web/src/lib/demo-action-gate.test.tsx":
    "Demo action gate UI suite excluded from default node --test script",
  "apps/web/src/lib/demo-guards.test.ts":
    "Demo guard suite excluded from default node --test script",
  "apps/web/src/lib/format.test.ts":
    "Formatting helper suite excluded from default node --test script",
  "apps/web/src/lib/network-guard.test.ts":
    "Network guard suite excluded from default node --test script",
  "apps/web/src/lib/round-phase.test.ts":
    "Round phase helper suite excluded from default node --test script",
  "apps/web/src/lib/use-reveal-phase.test.ts":
    "Reveal phase hook suite excluded from default node --test script",
  "apps/web/src/pages/DemoPage.test.tsx":
    "Full DemoPage integration suite excluded from default node --test script",
});

function walkTestFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, out);
    } else if (TEST_FILE_PATTERN.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract relative test file paths referenced in a package's `test` script.
 */
export function extractScriptTestFiles(testScript) {
  if (typeof testScript !== "string" || !testScript.trim()) {
    return new Set();
  }
  const matches =
    testScript.match(/[A-Za-z0-9_./-]+\.test\.(?:tsx|ts|mjs|cjs|js)/g) ?? [];
  return new Set(matches.map((m) => m.replace(/^\.\//, "")));
}

/**
 * Compare all workspace test files on disk against `package.json` `scripts.test`
 * and `documentedExclusions`.
 */
export function verifyWorkspaceTestDiscovery(
  rootDir = DEFAULT_ROOT,
  { documentedExclusions = DOCUMENTED_EXCLUDED_TEST_FILES } = {},
) {
  const issues = [];
  const discoveredFiles = new Set();

  for (const container of WORKSPACE_CONTAINERS) {
    const absContainer = join(rootDir, container);
    if (!existsSync(absContainer)) continue;
    const entries = readdirSync(absContainer, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsDir = join(absContainer, entry.name);
      const pkgPath = join(wsDir, "package.json");
      if (!existsSync(pkgPath)) continue;

      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const wsName = pkg.name ?? `${container}/${entry.name}`;
      const testScript = pkg.scripts?.test ?? "";
      const scriptFiles = extractScriptTestFiles(testScript);
      const diskFiles = walkTestFiles(wsDir);

      for (const absFile of diskFiles) {
        const relToRoot = relative(rootDir, absFile).split("\\").join("/");
        const relToWs = relative(wsDir, absFile).split("\\").join("/");
        discoveredFiles.add(relToRoot);

        const inScript = scriptFiles.has(relToWs);
        const exclusionReason = documentedExclusions[relToRoot];
        const isDocumentedExclusion =
          typeof exclusionReason === "string" &&
          exclusionReason.trim().length > 0;

        if (!inScript && !isDocumentedExclusion) {
          issues.push(
            `${relToRoot} is excluded from ${wsName} package.json "test" script and is not documented in DOCUMENTED_EXCLUDED_TEST_FILES`,
          );
        } else if (inScript && isDocumentedExclusion) {
          issues.push(
            `${relToRoot} is included in ${wsName} package.json "test" script; remove its stale entry from DOCUMENTED_EXCLUDED_TEST_FILES`,
          );
        }
      }

      for (const scriptFile of scriptFiles) {
        const absScriptFile = join(wsDir, scriptFile);
        if (!existsSync(absScriptFile)) {
          const relMissing = `${container}/${entry.name}/${scriptFile}`;
          issues.push(
            `${wsName} package.json "test" script references missing test file ${relMissing}`,
          );
        }
      }
    }
  }

  for (const [excludedPath, reason] of Object.entries(documentedExclusions)) {
    if (typeof reason !== "string" || !reason.trim()) {
      issues.push(
        `DOCUMENTED_EXCLUDED_TEST_FILES entry ${excludedPath} must provide a non-empty reason`,
      );
    }
    if (!discoveredFiles.has(excludedPath)) {
      issues.push(
        `DOCUMENTED_EXCLUDED_TEST_FILES lists ${excludedPath}, which does not exist on disk`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const res = verifyWorkspaceTestDiscovery(DEFAULT_ROOT);
  if (!res.ok) {
    for (const issue of res.issues) {
      process.stderr.write(`❌ ${issue}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    "✅ All workspace test files are executed by package.json test scripts or explicitly documented.\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
