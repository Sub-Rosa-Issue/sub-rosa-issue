// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'check-lockfile-sources.mjs');
const PROJECT_ROOT = resolve(__dirname, '..');
const VALID_FIXTURE = resolve(PROJECT_ROOT, 'fixtures/lockfile-sources/valid-lockfile.yaml');
const INVALID_FIXTURE = resolve(PROJECT_ROOT, 'fixtures/lockfile-sources/invalid-lockfile.yaml');

function runScript(lockfilePath, options = {}) {
  return execFileSync("node", [SCRIPT_PATH, lockfilePath], {
    encoding: "utf-8",
    cwd: PROJECT_ROOT,
    ...options,
  });
}

function runScriptExpectFailure(lockfilePath) {
  try {
    runScript(lockfilePath);
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

describe("check-lockfile-sources", () => {
  it("passes for valid lockfile with only allowed sources", () => {
    const result = runScript(VALID_FIXTURE);
    assert.match(result, /OK.*dependency source\(s\) checked — all compliant/);
  });

  it("fails for lockfile with git dependency", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    assert.equal(outcome.failed, true, "expected script to fail");
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /github:/, "expected violation for github: protocol (pnpm GitHub shorthand)");
  });

  it("fails for lockfile with git+ssh dependency", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /git\+ssh:/, "expected violation for git+ssh: protocol");
  });

  it("fails for lockfile with file: dependency", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /file:/, "expected violation for file: protocol");
  });

  it("fails for lockfile with http: (non-HTTPS) dependency", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /http:/, "expected violation for http: protocol");
  });

  it("fails for lockfile with external link: dependency", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    // The external link: should be caught (not the workspace link:)
    assert.match(combined, /external-link.*link:.*not allowed/);
  });

  it("allows workspace: specifier for workspace dependencies", () => {
    const result = runScript(VALID_FIXTURE);
    assert.match(result, /OK.*dependency source\(s\) checked — all compliant/);
  });

  it("allows link: in version field for workspace dependency resolutions", () => {
    const result = runScript(VALID_FIXTURE);
    assert.match(result, /OK.*dependency source\(s\) checked — all compliant/);
  });

  it("allows HTTPS from npm registry", () => {
    const result = runScript(VALID_FIXTURE);
    assert.match(result, /OK.*dependency source\(s\) checked — all compliant/);
  });

  it("prints sanitized source identifiers without credentials", () => {
    const outcome = runScriptExpectFailure(INVALID_FIXTURE);
    const combined = outcome.stdout + outcome.stderr;
    // Check that full URLs with credentials are not printed
    // Actual credential pattern would be "git+ssh://git@" or "ssh://git@" etc.
    assert.ok(!combined.includes('git+ssh://git@'), "should not print credentials in git+ssh URLs");
    assert.ok(!combined.includes('ssh://git@'), "should not print credentials in ssh URLs");
    assert.ok(!combined.includes('https://git@'), "should not print credentials in https URLs");
    assert.ok(!combined.includes('http://git@'), "should not print credentials in http URLs");
  });
});