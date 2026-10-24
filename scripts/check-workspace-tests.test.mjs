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
} from "./check-workspace-tests.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function createTempWorkspaceRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "sub-rosa-ws-tests-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("check-workspace-tests", () => {
  it("passes on the real repository", () => {
    const orphaned = findOrphanedWorkspaceTests(REPO_ROOT);
    assert.deepEqual(orphaned, []);
  });

  it("extracts explicit test files and recognizes discovery runners", () => {
    const explicit = extractReferencedTests(
      "node --import tsx --test src/a.test.ts src/b.test.tsx",
    );
    assert.ok(explicit instanceof Set);
    assert.deepEqual([...explicit], ["src/a.test.ts", "src/b.test.tsx"]);

    assert.equal(extractReferencedTests("node scripts/run-tests.mjs"), "*");
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
      const orphaned = findOrphanedWorkspaceTests(root);
      assert.deepEqual(orphaned, []);
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
      const orphaned = findOrphanedWorkspaceTests(root);
      assert.deepEqual(orphaned, [
        "packages/alpha/src/forgotten.test.ts",
        "services/beta/src/unwired.test.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
