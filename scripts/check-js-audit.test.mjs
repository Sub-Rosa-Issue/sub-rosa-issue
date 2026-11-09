// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUDIT_COMMAND,
  AUDIT_SEVERITY_THRESHOLD,
  LOCKFILE_VERSION,
  inspectPackageJsonAuditPolicy,
  inspectPnpmLock,
  validateJsAuditSetup,
} from "./check-js-audit.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-js-audit", () => {
  it("passes on the repository root configuration", () => {
    const res = validateJsAuditSetup(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got errors: ${res.errors.join("; ")}`);
  });

  it("enforces high severity threshold on production dependencies", () => {
    assert.equal(AUDIT_SEVERITY_THRESHOLD, "high");
    assert.equal(AUDIT_COMMAND, "pnpm audit --prod --audit-level=high");
    assert.equal(LOCKFILE_VERSION, "9.0");
  });

  it("rejects pnpm-lock.yaml files missing lockfileVersion 9.0 or sha512 integrity", () => {
    const badLock = `
lockfileVersion: '6.0'
importers:
  .: {}
`;
    const res = inspectPnpmLock(badLock);
    assert.ok(res.errors.some((e) => e.includes("lockfileVersion: '9.0'")));
    assert.ok(res.errors.some((e) => e.includes("sha512 package integrity")));
  });

  it("rejects unapproved GHSA exceptions or missing audit scripts in package.json", () => {
    const res = inspectPackageJsonAuditPolicy({
      scripts: {
        "js:audit": "pnpm audit",
      },
      pnpm: {
        auditConfig: {
          ignoreGhsas: ["GHSA-1234-5678-9abc"],
        },
      },
    });
    assert.ok(res.errors.some((e) => e.includes(`"js:audit": "${AUDIT_COMMAND}"`)));
    assert.ok(res.errors.some((e) => e.includes("js:audit:check")));
    assert.ok(res.errors.some((e) => e.includes("js:audit:test")));
    assert.ok(res.errors.some((e) => e.includes("GHSA-1234-5678-9abc")));
  });

  it("fails when pnpm-lock.yaml or workflow audit steps are missing in a workspace", () => {
    const tmp = mkdtempSync(join(tmpdir(), "js-audit-test-"));
    try {
      mkdirSync(join(tmp, "docs"), { recursive: true });
      mkdirSync(join(tmp, ".github/workflows"), { recursive: true });
      copyFileSync(join(REPO_ROOT, "package.json"), join(tmp, "package.json"));
      copyFileSync(join(REPO_ROOT, "docs/CI.md"), join(tmp, "docs/CI.md"));
      writeFileSync(join(tmp, ".github/workflows/coverage.yml"), "name: coverage\n");
      const res = validateJsAuditSetup(tmp);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes("Missing committed pnpm-lock.yaml")));
      assert.ok(res.errors.some((e) => e.includes("pnpm js:audit:test")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
