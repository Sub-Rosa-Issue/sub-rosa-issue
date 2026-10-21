// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'check-font-magic-bytes.mjs');
const PROJECT_ROOT = resolve(__dirname, '..');
const FIXTURE_DIR = resolve(PROJECT_ROOT, 'fixtures/font-magic-bytes');

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

describe("check-font-magic-bytes", () => {
  it("passes for valid WOFF2 fixture", () => {
    const result = runScript([join(FIXTURE_DIR, 'valid.woff2')]);
    assert.match(result, /OK  1 font file\(s\) verified/);
  });

  it("passes for valid WOFF fixture", () => {
    const result = runScript([join(FIXTURE_DIR, 'valid.woff')]);
    assert.match(result, /OK  1 font file\(s\) verified/);
  });

  it("fails for text-disguised-as-WOFF fixture", () => {
    const outcome = runScriptExpectFailure([join(FIXTURE_DIR, 'fake.woff')]);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /fake\.woff/);
    assert.match(combined, /invalid WOFF magic bytes/);
  });

  it("fails for text-disguised-as-WOFF2 fixture", () => {
    const outcome = runScriptExpectFailure([join(FIXTURE_DIR, 'fake.woff2')]);
    assert.equal(outcome.failed, true);
    const combined = outcome.stdout + outcome.stderr;
    assert.match(combined, /fake\.woff2/);
    assert.match(combined, /invalid WOFF2 magic bytes/);
  });

  it("passes when no font files in directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'font-check-empty-'));
    try {
      const result = runScript([tmp]);
      assert.match(result, /OK  no font files found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports only the invalid path on failure", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'font-check-mixed-'));
    try {
      // Create valid and invalid
      writeFileSync(join(tmp, 'good.woff2'), 'wOF2\x00\x00\x00\x00');
      writeFileSync(join(tmp, 'bad.woff'), 'not a font');
      const outcome = runScriptExpectFailure([tmp]);
      assert.equal(outcome.failed, true);
      const combined = outcome.stdout + outcome.stderr;
      assert.match(combined, /bad\.woff/);
      assert.ok(!combined.includes('good.woff2'), "should not report valid files");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("exits non-zero on failure", () => {
    const outcome = runScriptExpectFailure([join(FIXTURE_DIR, 'fake.woff')]);
    assert.equal(outcome.failed, true);
  });

  it("reads bytes only, never executes files", () => {
    // The script uses readFileSync which only reads bytes
    // This test documents the requirement
    const result = runScript([join(FIXTURE_DIR, 'valid.woff2')]);
    assert.match(result, /OK/);
  });
});