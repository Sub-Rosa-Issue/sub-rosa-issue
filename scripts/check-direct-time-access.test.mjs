import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findViolations, scanTree } from "./check-direct-time-access.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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
  it("passes on the current repository tree", () => {
    const violations = scanTree();
    assert.equal(
      violations.length,
      0,
      violations.map((v) => `${v.relPath}:${v.line}`).join("\n"),
    );
  });

  it("wires time:guard:test and time:guard into CI and documents the check", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["time:guard"], "node scripts/check-direct-time-access.mjs");
    assert.equal(
      pkg.scripts["time:guard:test"],
      "node --test scripts/check-direct-time-access.test.mjs",
    );
    assert.match(pkg.scripts["coverage:test"], /check-direct-time-access\.test\.mjs/);
    assert.match(pkg.scripts["coverage:test"], /check-direct-time-access\.mjs/);

    const ciDocs = readFileSync(join(REPO_ROOT, "docs", "CI.md"), "utf8");
    assert.match(ciDocs, /pnpm time:guard:test/);
    assert.match(ciDocs, /pnpm time:guard/);
  });
});
