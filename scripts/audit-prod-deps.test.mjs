// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AUDIT_COMMAND,
  DEFAULT_AUDIT_LEVEL,
  buildPnpmAuditArgs,
  collectAdvisories,
  evaluateAuditReport,
  validateAuditException,
  validateAuditProdSetup,
} from "./audit-prod-deps.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXED_NOW = Date.parse("2026-06-01T00:00:00.000Z");

describe("audit-prod-deps", () => {
  it("builds production-only pnpm audit arguments with default high threshold", () => {
    assert.equal(DEFAULT_AUDIT_LEVEL, "high");
    assert.equal(AUDIT_COMMAND, "pnpm audit --prod --audit-level=high --json");
    assert.deepEqual(buildPnpmAuditArgs(), [
      "audit",
      "--prod",
      "--audit-level=high",
      "--json",
    ]);
  });

  it("passes on the repository root configuration", () => {
    const res = validateAuditProdSetup(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got errors: ${res.errors.join("; ")}`);
  });

  it("passes when no advisories meet or exceed the high threshold", () => {
    const report = {
      advisories: {
        1: {
          github_advisory_id: "GHSA-low-1111",
          module_name: "some-pkg",
          severity: "moderate",
          title: "Moderate issue",
        },
      },
    };
    const res = evaluateAuditReport(report, { nowMs: FIXED_NOW });
    assert.equal(res.ok, true);
    assert.equal(res.blockingAdvisories.length, 0);
  });

  it("fails when a high or critical production advisory has no exception", () => {
    const report = {
      advisories: {
        100: {
          github_advisory_id: "GHSA-crit-9999",
          module_name: "ws",
          severity: "critical",
          title: "DoS in ws",
        },
      },
    };
    const res = evaluateAuditReport(report, { nowMs: FIXED_NOW });
    assert.equal(res.ok, false);
    assert.equal(res.blockingAdvisories.length, 1);
    assert.equal(res.blockingAdvisories[0].id, "GHSA-crit-9999");
    assert.equal(res.blockingAdvisories[0].package, "ws");
  });

  it("allows a high advisory only when covered by an unexpired, complete exception", () => {
    const report = {
      advisories: {
        100: {
          github_advisory_id: "GHSA-high-1234",
          module_name: "elliptic",
          severity: "high",
          title: "Curve twist issue",
        },
      },
    };
    const validException = {
      id: "GHSA-high-1234",
      package: "elliptic",
      reason: "Transitive dependency not invoked on untrusted curve inputs",
      expiresOn: "2026-07-01",
      trackingIssue: "#529",
    };

    const res = evaluateAuditReport(report, {
      exceptions: [validException],
      nowMs: FIXED_NOW,
    });
    assert.equal(res.ok, true);
    assert.equal(res.ignoredAdvisories.length, 1);
  });

  it("rejects expired or incomplete audit exceptions", () => {
    const expired = validateAuditException(
      {
        id: "GHSA-high-1234",
        package: "elliptic",
        reason: "Waiting on upstream release",
        expiresOn: "2026-05-01",
        trackingIssue: "#529",
      },
      FIXED_NOW,
    );
    assert.equal(expired.valid, false);
    assert.match(expired.reason, /expired/);

    const missingField = validateAuditException(
      {
        id: "GHSA-high-1234",
        package: "elliptic",
        reason: "",
        expiresOn: "2026-07-01",
        trackingIssue: "#529",
      },
      FIXED_NOW,
    );
    assert.equal(missingField.valid, false);
    assert.match(missingField.reason, /reason/);
  });

  it("collects advisories from npm-style vulnerabilities maps", () => {
    const report = {
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "high",
          via: [
            {
              source: 123,
              name: "lodash",
              severity: "high",
              title: "Prototype pollution",
              url: "https://github.com/advisories/GHSA-lodash-high",
            },
          ],
        },
      },
    };
    const list = collectAdvisories(report);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "GHSA-lodash-high");
    assert.equal(list[0].package, "lodash");
    assert.equal(list[0].severity, "high");
  });

  it("runs audit:prod test and check as blocking CI steps in coverage.yml", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/coverage.yml", import.meta.url),
      "utf8",
    );
    const scripts = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).scripts;
    assert.equal(scripts["audit:prod"], "node scripts/audit-prod-deps.mjs");
    assert.equal(scripts["audit:prod:test"], "node --test scripts/audit-prod-deps.test.mjs");
    const job = workflow.match(/^  coverage:\n([\s\S]*)$/m)?.[1];
    assert.ok(job, "coverage job must exist");
    assert.doesNotMatch(job, /\bcontinue-on-error\s*:/);
    const testStep = job.indexOf("        run: pnpm audit:prod:test\n");
    const auditStep = job.indexOf("        run: pnpm audit:prod\n");
    assert.ok(
      testStep >= 0 && auditStep > testStep,
      "audit:prod must follow audit:prod:test in the coverage job",
    );
  });
});
