// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkContractSnapshots,
  checkDashboardEvidence,
  checkSnapshots,
  DEFAULT_CHECKSUM_PATH,
  DEFAULT_DEMO_TRACE_PATH,
  REQUIRED_CATEGORIES,
} from "./check-snapshots.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./check-snapshots.mjs", import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_PATH = fileURLToPath(
  new URL("../.github/workflows/snapshots.yml", import.meta.url),
);
const CONTRACT_WORKFLOW_PATH = fileURLToPath(
  new URL("../.github/workflows/contract.yml", import.meta.url),
);
const CI_DOCS_PATH = fileURLToPath(new URL("../docs/CI.md", import.meta.url));

const VALID_SNAPSHOT_JSON = JSON.stringify({
  generators: { address: 1, nonce: 0 },
  auth: [],
  ledger: { protocol_version: 22, sequence_number: 1 },
  events: [],
});

function createSnapshotFixture({ omitCategory = null, corruptCategory = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-snapshots-"));
  for (const category of REQUIRED_CATEGORIES) {
    if (category === omitCategory) continue;
    const payload =
      category === corruptCategory
        ? JSON.stringify({ generators: {}, auth: "not-an-array" })
        : VALID_SNAPSHOT_JSON;
    writeFileSync(join(dir, `${category}.1.json`), payload);
  }
  return dir;
}

describe("check-snapshots", () => {
  it("passes against committed repository contract snapshots and dashboard evidence", () => {
    const result = checkSnapshots();
    assert.equal(result.ok, true);
    assert.equal(result.contract.missingCategories.length, 0);
    assert.equal(result.contract.invalidSnapshots.length, 0);
    assert.equal(result.dashboard.issues.length, 0);

    const cli = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /required snapshot categories and dashboard evidence are healthy/);
  });

  it("fails when the snapshot directory is missing", () => {
    const missingDir = join(tmpdir(), "nonexistent-sub-rosa-snapshots-dir");
    const result = checkContractSnapshots(missingDir);
    assert.equal(result.ok, false);
    assert.ok(result.dirError);
  });

  it("fails when a required contract snapshot category is missing", () => {
    const dir = createSnapshotFixture({ omitCategory: "settle_exact_payouts_table" });
    try {
      const result = checkContractSnapshots(dir);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missingCategories, ["settle_exact_payouts_table"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a committed snapshot file has a corrupted or incomplete payload", () => {
    const dir = createSnapshotFixture({
      corruptCategory: "create_round_happy_path",
    });
    try {
      const result = checkContractSnapshots(dir);
      assert.equal(result.ok, false);
      assert.equal(result.invalidSnapshots.length, 1);
      assert.match(
        result.invalidSnapshots[0],
        /create_round_happy_path\.1\.json: missing or invalid 'auth' array/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when generated dashboard evidence is stale or missing required milestones", () => {
    const dir = mkdtempSync(join(tmpdir(), "sub-rosa-demo-evidence-"));
    try {
      const traceSource = readFileSync(DEFAULT_DEMO_TRACE_PATH, "utf8");
      const staleTracePath = join(dir, "demo-trace.generated.ts");
      const staleSource = traceSource.replace('"phase": "open_reveal"', '"phase": "stale_phase"');
      writeFileSync(staleTracePath, staleSource);

      const result = checkDashboardEvidence({
        demoTracePath: staleTracePath,
        checksumPath: DEFAULT_CHECKSUM_PATH,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((issue) =>
          issue.includes("missing required milestones: open_reveal"),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the milestone checksum diverges from REQUIRED_MILESTONES", () => {
    const dir = mkdtempSync(join(tmpdir(), "sub-rosa-checksum-drift-"));
    try {
      const checksumSource = readFileSync(DEFAULT_CHECKSUM_PATH, "utf8");
      const driftedChecksumPath = join(dir, "demo-trace.checksum.ts");
      writeFileSync(
        driftedChecksumPath,
        checksumSource.replace(/[0-9a-f]{64}/, "0".repeat(64)),
      );

      const result = checkDashboardEvidence({
        demoTracePath: DEFAULT_DEMO_TRACE_PATH,
        checksumPath: driftedChecksumPath,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((issue) =>
          issue.includes("LIFE_CYCLE_PHASES_CHECKSUM mismatch"),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("enforces snapshot:check in CI workflows and documents the gate", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(workflow, /^  push:\n    branches: \[main\]$/m);
    assert.match(workflow, /^  pull_request:$/m);
    assert.doesNotMatch(workflow, /\bcontinue-on-error\s*:/);
    assert.match(workflow, /pnpm snapshot:test/);
    assert.match(workflow, /pnpm snapshot:check/);

    const contractWorkflow = readFileSync(CONTRACT_WORKFLOW_PATH, "utf8");
    assert.match(contractWorkflow, /node scripts\/check-snapshots\.mjs/);
    assert.match(contractWorkflow, /node --test scripts\/check-snapshots\.test\.mjs/);

    const docs = readFileSync(CI_DOCS_PATH, "utf8");
    assert.match(docs, /snapshots\.yml/);
    assert.match(docs, /pnpm snapshot:check/);
  });
});
