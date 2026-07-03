import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT_PATH = new URL(
  "check-threat-model-anchors.mjs",
  import.meta.url,
).pathname;
const PROJECT_ROOT = new URL("..", import.meta.url).pathname;

function runScript(args = [], options = {}) {
  return execFileSync("node", [SCRIPT_PATH, ...args], {
    encoding: "utf-8",
    cwd: PROJECT_ROOT,
    ...options,
  });
}

function runScriptExpectFailure(args = []) {
  try {
    runScript(args);
    return { failed: false, stderr: "", stdout: "" };
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    return {
      failed: true,
      stderr: e.stderr ? e.stderr.toString() : "",
      stdout: e.stdout ? e.stdout.toString() : e.message,
    };
  }
}

describe("check-threat-model-anchors", () => {
  it("passes against the real docs/THREAT_MODEL.md", () => {
    const result = runScript();
    assert.match(
      result,
      /All 5 required threat model anchors are present\./,
      "expected the check to report all 5 required anchors present",
    );
    assert.match(
      result,
      /Threat model anchor coverage for docs\/THREAT_MODEL\.md/,
      "expected the check header to mention the default doc path",
    );
  });

  it("reports every required topic by label", () => {
    const result = runScript();
    assert.match(result, /Commit privacy/i);
    assert.match(result, /Drand reveal timing/i);
    assert.match(result, /Escrow settlement/i);
    assert.match(result, /Keeper permissionlessness/i);
    assert.match(result, /Receipt verification/i);
  });

  it("marks every required topic as PASS for the real doc", () => {
    const result = runScript();
    const passCount = (result.match(/\[PASS\]/g) ?? []).length;
    // 1 for each of the 5 topics + 1 for the closing "All N required" line echo.
    assert.ok(passCount >= 5, `expected at least 5 [PASS] markers, saw ${passCount}`);
    assert.equal(
      (result.match(/\[FAIL\]/g) ?? []).length,
      0,
      "expected no [FAIL] markers against the real doc",
    );
  });

  it("passes when given a custom doc path containing the required anchors", () => {
    const tmp = mkdtempSync(join(tmpdir(), "threat-model-ok-"));
    try {
      const target = join(tmp, "THREAT_MODEL.md");
      // Copy the real doc — the script's contract is that any doc with the
      // required anchors passes, regardless of filename.
      copyFileSync(join(PROJECT_ROOT, "docs/THREAT_MODEL.md"), target);
      const result = runScript([target]);
      assert.match(result, /All 5 required threat model anchors are present\./);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when required anchors are missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "threat-model-bad-"));
    try {
      const target = join(tmp, "THREAT_MODEL.md");
      // A doc that has none of the risk topics at all.
      writeFileSync(
        target,
        [
          "# Sub Rosa — Threat Model",
          "",
          "## Assets",
          "",
          "| Asset | Location | Sensitivity |",
          "| --- | --- | --- |",
          "| Generic asset | Off-chain | Low |",
          "",
          "## Protections",
          "",
          "Nothing here.",
          "",
        ].join("\n"),
      );
      const outcome = runScriptExpectFailure([target]);
      assert.equal(outcome.failed, true, "expected script to fail");
      const combined = outcome.stdout + outcome.stderr;
      assert.match(
        combined,
        /Missing 5 required threat model anchor/,
        "expected the failure to mention all 5 missing anchors",
      );
      assert.match(combined, /commit-privacy/);
      assert.match(combined, /drand-reveal-timing/);
      assert.match(combined, /escrow-settlement/);
      assert.match(combined, /keeper-permissionlessness/);
      assert.match(combined, /receipt-verification/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails (and reports only the missing ids) when some anchors are removed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "threat-model-partial-"));
    try {
      const target = join(tmp, "THREAT_MODEL.md");
      // A doc that keeps Drand coverage but silently drops the others.
      const body = [
        "# Sub Rosa — Threat Model",
        "",
        "## Protections",
        "",
        "Drand never delivers R: void after grace window funds escrowed bids.",
        "",
      ].join("\n");
      writeFileSync(target, body);
      const outcome = runScriptExpectFailure([target]);
      assert.equal(outcome.failed, true);
      const combined = outcome.stdout + outcome.stderr;
      // Only drand-reveal-timing matches; everything else should be reported.
      assert.match(combined, /commit-privacy/);
      assert.match(combined, /escrow-settlement/);
      assert.match(combined, /keeper-permissionlessness/);
      assert.match(combined, /receipt-verification/);
      assert.match(
        combined,
        /Missing 4 required threat model anchor\b/,
        "expected exactly 4 missing anchors",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("exits non-zero with a hint when the doc path is invalid", () => {
    const outcome = runScriptExpectFailure([
      "docs/does-not-exist-threat-model.md",
    ]);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /not found/);
  });
});
