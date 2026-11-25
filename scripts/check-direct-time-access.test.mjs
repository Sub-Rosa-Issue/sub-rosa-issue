import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findViolations, scanTree } from "./check-direct-time-access.mjs";

describe("findViolations", () => {
  it("allows packages/time/src/system.ts", () => {
    const hits = findViolations(
      "const x = Date.now();\nsetTimeout(() => {}, 1);",
      "packages/time/src/system.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("flags Date.now in application code", () => {
    const hits = findViolations(
      "const t = Date.now();",
      "packages/sdk/src/client.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, "Date.now(");
  });

  it("does not flag Stellar .setTimeout( chains", () => {
    const hits = findViolations(
      "tx.setTimeout(120).build();",
      "services/keeper/scripts/usdc-setup.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("flags bare setTimeout", () => {
    const hits = findViolations(
      "setTimeout(() => process.exit(1), 5000);",
      "services/keeper/src/status-server.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, "setTimeout(");
  });
});

describe("scanTree", () => {
  it("fails if the scan roots are missing", () => {
    assert.throws(() => scanTree(join(tmpdir(), "missing-time-guard-roots")), /No direct-time-access scan roots/);
  });

  it("detects direct clock access in a path containing spaces", () => {
    const root = mkdtempSync(join(tmpdir(), "time guard "));
    try {
      const sourceDir = join(root, "packages", "sdk", "src");
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, "client.ts"), "const now = Date.now();\n");
      assert.deepEqual(
        scanTree(root).map(({ relPath, pattern }) => ({ relPath, pattern })),
        [{ relPath: "packages/sdk/src/client.ts", pattern: "Date.now(" }],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes on the current repository tree", () => {
    const violations = scanTree();
    assert.equal(
      violations.length,
      0,
      violations.map((v) => `${v.relPath}:${v.line}`).join("\n"),
    );
  });
});

it("runs both time guard commands as blocking CI steps", () => {
  const workflow = readFileSync(new URL("../.github/workflows/coverage.yml", import.meta.url), "utf8");
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.match(workflow, /^  push:\n    branches: \[main\]$/m);
  assert.match(workflow, /^  pull_request:$/m);
  const job = workflow.match(/^  coverage:\n([\s\S]*)$/m)?.[1];
  assert.ok(job, "coverage job must exist");
  assert.doesNotMatch(job, /\bcontinue-on-error\s*:/);
  assert.equal(scripts["time:guard:test"], "node --test scripts/check-direct-time-access.test.mjs");
  assert.equal(scripts["time:guard"], "node scripts/check-direct-time-access.mjs");
  const testStep = job.indexOf("        run: pnpm time:guard:test\n");
  const guardStep = job.indexOf("        run: pnpm time:guard\n");
  assert.ok(testStep >= 0 && guardStep > testStep, "guard must follow its tests in the coverage job");
});
