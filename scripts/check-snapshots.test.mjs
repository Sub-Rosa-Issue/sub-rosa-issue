// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SCRIPT_PATH = fileURLToPath(new URL("check-snapshots.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-snapshots", () => {
  it("passes on the committed contract snapshot directory", () => {
    const out = execFileSync("node", [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.match(out, /required snapshot categories are present/);
  });

  it("fails with exit code 1 when required snapshot files are missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "snapshots-test-"));
    try {
      writeFileSync(join(tmp, "create_round_happy_path.1.json"), "{}\n");
      let failed = false;
      let output = "";
      try {
        execFileSync("node", [SCRIPT_PATH], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, SNAPSHOT_DIR_OVERRIDE: tmp },
        });
      } catch (err) {
        failed = true;
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      assert.equal(failed, true);
      assert.match(output, /required snapshot category\/categories missing/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("enforces snapshot:check in CI workflows", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const coverageWorkflow = readFileSync(
      join(REPO_ROOT, ".github/workflows/coverage.yml"),
      "utf8",
    );
    const contractWorkflow = readFileSync(
      join(REPO_ROOT, ".github/workflows/contract.yml"),
      "utf8",
    );

    assert.equal(pkg.scripts?.["snapshot:check"], "node scripts/check-snapshots.mjs");
    assert.equal(pkg.scripts?.["snapshot:test"], "node --test scripts/check-snapshots.test.mjs");
    assert.match(coverageWorkflow, /pnpm snapshot:test\s*&&\s*pnpm snapshot:check/);
    assert.match(contractWorkflow, /node scripts\/check-snapshots\.mjs/);
  });
});
