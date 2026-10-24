// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_LOCKFILES,
  REQUIRED_LOCKFILE,
  REQUIRED_PACKAGE_MANAGER,
  checkSingleLockfile,
} from "./check-single-lockfile.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function stageWorkspace(tmp) {
  mkdirSync(join(tmp, "docs"), { recursive: true });
  copyFileSync(join(REPO_ROOT, ".gitignore"), join(tmp, ".gitignore"));
  copyFileSync(join(REPO_ROOT, "package.json"), join(tmp, "package.json"));
  copyFileSync(join(REPO_ROOT, "docs/CI.md"), join(tmp, "docs/CI.md"));
  writeFileSync(join(tmp, REQUIRED_LOCKFILE), "lockfileVersion: '9.0'\n");
}

describe("check-single-lockfile", () => {
  it("passes on the repository root", () => {
    const res = checkSingleLockfile(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got errors: ${res.errors.join("; ")}`);
  });

  it("fails when any competing lockfile is present at the root", () => {
    for (const competing of FORBIDDEN_LOCKFILES) {
      const tmp = mkdtempSync(join(tmpdir(), "single-lockfile-bad-"));
      try {
        stageWorkspace(tmp);
        writeFileSync(join(tmp, competing), "{}");
        const res = checkSingleLockfile(tmp);
        assert.equal(res.ok, false, `Expected failure for ${competing}`);
        assert.ok(
          res.errors.some((e) => e.includes(`Forbidden root lockfile "${competing}"`)),
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  });

  it("fails when pnpm-lock.yaml is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "single-lockfile-missing-"));
    try {
      stageWorkspace(tmp);
      rmSync(join(tmp, REQUIRED_LOCKFILE));
      const res = checkSingleLockfile(tmp);
      assert.equal(res.ok, false);
      assert.ok(
        res.errors.some((e) => e.includes(`Missing required root lockfile ${REQUIRED_LOCKFILE}`)),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("enforces pnpm@10.13.1 as the required packageManager", () => {
    assert.equal(REQUIRED_PACKAGE_MANAGER, "pnpm@10.13.1");
  });
});
