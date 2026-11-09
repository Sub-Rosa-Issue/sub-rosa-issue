// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCUMENTED_EXCLUDED_TEST_FILES,
  extractScriptTestFiles,
  verifyWorkspaceTestDiscovery,
} from "./check-test-discovery.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

describe("workspace test discovery check", () => {
  it("extracts test file paths from package.json test scripts", () => {
    const files = extractScriptTestFiles(
      "node --import tsx --test src/a.test.ts ./src/b.test.tsx && node --test scripts/c.test.mjs",
    );
    assert.deepEqual([...files].sort(), [
      "scripts/c.test.mjs",
      "src/a.test.ts",
      "src/b.test.tsx",
    ]);
  });

  it("passes on the repository workspace tree", () => {
    const res = verifyWorkspaceTestDiscovery(REPO_ROOT);
    assert.equal(res.ok, true, `Unexpected issues: ${res.issues.join("; ")}`);
    assert.ok(Object.keys(DOCUMENTED_EXCLUDED_TEST_FILES).length > 0);
  });

  it("fails when a test file exists on disk but is excluded from package.json and undocumented", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-test-disc-"));
    try {
      const wsSrc = join(tmp, "packages", "alpha", "src");
      mkdirSync(wsSrc, { recursive: true });
      writeFileSync(
        join(tmp, "packages", "alpha", "package.json"),
        JSON.stringify({
          name: "@sub-rosa/alpha",
          scripts: {
            test: "node --import tsx --test src/included.test.ts",
          },
        }),
      );
      writeFileSync(join(wsSrc, "included.test.ts"), "// included\n");
      writeFileSync(join(wsSrc, "orphaned.test.ts"), "// orphaned\n");

      const res = verifyWorkspaceTestDiscovery(tmp, {
        documentedExclusions: {},
      });
      assert.equal(res.ok, false);
      assert.equal(res.issues.length, 1);
      assert.match(res.issues[0], /packages\/alpha\/src\/orphaned\.test\.ts/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes when an excluded integration test file is explicitly documented", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-test-disc-doc-"));
    try {
      const wsSrc = join(tmp, "services", "beta", "src");
      mkdirSync(wsSrc, { recursive: true });
      writeFileSync(
        join(tmp, "services", "beta", "package.json"),
        JSON.stringify({
          name: "@sub-rosa/beta",
          scripts: {
            test: "node --import tsx --test src/unit.test.ts",
          },
        }),
      );
      writeFileSync(join(wsSrc, "unit.test.ts"), "// unit\n");
      writeFileSync(join(wsSrc, "integration.test.ts"), "// integration\n");

      const res = verifyWorkspaceTestDiscovery(tmp, {
        documentedExclusions: {
          "services/beta/src/integration.test.ts":
            "Requires live testnet RPC harness",
        },
      });
      assert.equal(res.ok, true, `Unexpected issues: ${res.issues.join("; ")}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when a documented exclusion is also added to package.json or missing from disk", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-test-disc-stale-"));
    try {
      const wsSrc = join(tmp, "packages", "gamma", "src");
      mkdirSync(wsSrc, { recursive: true });
      writeFileSync(
        join(tmp, "packages", "gamma", "package.json"),
        JSON.stringify({
          name: "@sub-rosa/gamma",
          scripts: {
            test: "node --import tsx --test src/unit.test.ts",
          },
        }),
      );
      writeFileSync(join(wsSrc, "unit.test.ts"), "// unit\n");

      const res = verifyWorkspaceTestDiscovery(tmp, {
        documentedExclusions: {
          "packages/gamma/src/unit.test.ts": "Stale exclusion already in script",
          "packages/gamma/src/nonexistent.test.ts": "Deleted test file",
        },
      });
      assert.equal(res.ok, false);
      assert.equal(res.issues.length, 2);
      assert.match(res.issues[0], /remove its stale entry/);
      assert.match(res.issues[1], /does not exist on disk/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
