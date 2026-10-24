// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_AUDIT_LEVEL,
  buildPnpmAuditArgs,
  evaluateAuditReport,
  validateAuditException,
} from "./audit-prod-deps.mjs";

const FIXED_NOW = Date.parse("2026-06-01T00:00:00.000Z");

describe("audit-prod-deps", () => {
  it("builds production-only pnpm audit arguments with default high threshold", () => {
    assert.equal(DEFAULT_AUDIT_LEVEL, "high");
    assert.deepEqual(buildPnpmAuditArgs(), [
      "audit",
      "--prod",
      "--audit-level=high",
      "--json",
    ]);
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
});
