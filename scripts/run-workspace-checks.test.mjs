// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  TEST_WORKSPACES,
  TYPECHECK_WORKSPACES,
  verifyAggregateCoverage,
} from "./run-workspace-checks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

describe("root test and typecheck aggregate scripts", () => {
  it("defines root test, typecheck, and time:typecheck scripts in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts.test, "node scripts/run-workspace-checks.mjs test");
    assert.equal(
      pkg.scripts.typecheck,
      "node scripts/run-workspace-checks.mjs typecheck",
    );
    assert.equal(
      pkg.scripts["time:typecheck"],
      "pnpm --filter @sub-rosa/time typecheck",
    );
  });

  it("enumerates every maintained workspace with test and typecheck scripts", () => {
    const res = verifyAggregateCoverage(REPO_ROOT);
    assert.equal(res.ok, true, `Unexpected issues: ${res.issues.join("; ")}`);
    assert.equal(TEST_WORKSPACES.length, 12);
    assert.equal(TYPECHECK_WORKSPACES.length, 11);
  });

  it("fails when a workspace defines test or typecheck but is omitted from the aggregate list", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-agg-"));
    try {
      mkdirSync(join(tmp, "packages", "alpha"), { recursive: true });
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node scripts/run-workspace-checks.mjs test",
            typecheck: "node scripts/run-workspace-checks.mjs typecheck",
          },
        }),
      );
      writeFileSync(
        join(tmp, "packages", "alpha", "package.json"),
        JSON.stringify({
          name: "@sub-rosa/alpha",
          scripts: { test: "node --test", typecheck: "tsc --noEmit" },
        }),
      );

      const res = verifyAggregateCoverage(tmp, {
        testWorkspaces: [],
        typecheckWorkspaces: [],
      });
      assert.equal(res.ok, false);
      assert.equal(res.issues.length, 2);
      assert.match(res.issues[0], /@sub-rosa\/alpha/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
