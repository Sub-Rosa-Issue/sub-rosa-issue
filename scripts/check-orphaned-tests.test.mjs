// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractReferencedTests,
  findOrphanedWorkspaceTests,
} from "./check-orphaned-tests.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function createTempWorkspaceRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "sub-rosa-orphaned-tests-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("check-orphaned-tests", () => {
  it("passes on the real repository", () => {
    const result = findOrphanedWorkspaceTests(REPO_ROOT);
    assert.equal(result.ok, true, result.issues.join("\n"));
    assert.deepEqual(result.issues, []);
  });

  it("extracts explicit test files and recognizes discovery runners", () => {
    const explicit = extractReferencedTests(
      "node --import tsx --test src/a.test.ts src/b.test.tsx",
    );
    assert.ok(explicit instanceof Set);
    assert.deepEqual([...explicit], ["src/a.test.ts", "src/b.test.tsx"]);

    assert.equal(extractReferencedTests("node scripts/run-tests.mjs"), "*");
    assert.equal(extractReferencedTests("node --test **/*.test.ts"), "*");
  });

  it("passes when every workspace test file is listed in scripts.test", () => {
    const root = createTempWorkspaceRepo({
      "packages/alpha/package.json": JSON.stringify({
        name: "@sub-rosa/alpha",
        scripts: {
          test: "node --import tsx --test src/one.test.ts src/two.test.ts",
        },
      }),
      "packages/alpha/src/one.test.ts": "// test 1\n",
      "packages/alpha/src/two.test.ts": "// test 2\n",
    });

    try {
      const result = findOrphanedWorkspaceTests(root, {
        documentedExclusions: {},
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.issues, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports orphaned test files excluded from package.json scripts.test", () => {
    const root = createTempWorkspaceRepo({
      "packages/alpha/package.json": JSON.stringify({
        name: "@sub-rosa/alpha",
        scripts: {
          test: "node --import tsx --test src/included.test.ts",
        },
      }),
      "packages/alpha/src/included.test.ts": "// included\n",
      "packages/alpha/src/forgotten.test.ts": "// forgotten\n",
      "services/beta/package.json": JSON.stringify({
        name: "@sub-rosa/beta",
        scripts: {},
      }),
      "services/beta/src/unwired.test.ts": "// unwired\n",
    });

    try {
      const result = findOrphanedWorkspaceTests(root, {
        documentedExclusions: {},
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.issues, [
        'packages/alpha/src/forgotten.test.ts is excluded from package.json "test" and is not listed in DOCUMENTED_EXCLUSIONS',
        'services/beta/src/unwired.test.ts is excluded from package.json "test" and is not listed in DOCUMENTED_EXCLUSIONS',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts documented exclusions and rejects stale ones", () => {
    const root = createTempWorkspaceRepo({
      "packages/alpha/package.json": JSON.stringify({
        name: "@sub-rosa/alpha",
        scripts: {
          test: "node --import tsx --test src/included.test.ts",
        },
      }),
      "packages/alpha/src/included.test.ts": "// included\n",
      "packages/alpha/src/skipped.test.ts": "// skipped\n",
    });

    try {
      const ok = findOrphanedWorkspaceTests(root, {
        documentedExclusions: {
          "packages/alpha/src/skipped.test.ts": "Intentional exclusion",
        },
      });
      assert.equal(ok.ok, true);

      const stale = findOrphanedWorkspaceTests(root, {
        documentedExclusions: {
          "packages/alpha/src/skipped.test.ts": "Intentional exclusion",
          "packages/alpha/src/included.test.ts": "Should not be here",
        },
      });
      assert.equal(stale.ok, false);
      assert.match(stale.issues[0], /stale DOCUMENTED_EXCLUSIONS entry/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
