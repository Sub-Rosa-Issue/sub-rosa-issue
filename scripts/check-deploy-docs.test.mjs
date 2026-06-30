import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT_PATH = new URL("check-deploy-docs.mjs", import.meta.url).pathname;
const CWD = new URL("..", import.meta.url).pathname;

function runCheck(env = {}) {
  return execFileSync("node", [SCRIPT_PATH], {
    encoding: "utf-8",
    cwd: CWD,
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
}

function runCheckExpectingFailure(env = {}) {
  try {
    runCheck(env);
    return { failed: false, output: "" };
  } catch (err) {
    return {
      failed: true,
      output: (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? ""),
    };
  }
}

// Stage a project rooted at `tmpDir` so `DEPLOY_DOCS_ROOT` points at it.
function stageFakeProject(tmpDir, deployMdBody) {
  mkdirSync(join(tmpDir, "docs"), { recursive: true });
  mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
  copyFileSync(join(CWD, ".env.example"), join(tmpDir, ".env.example"));
  copyFileSync(
    join(CWD, "apps/web/.env.example"),
    join(tmpDir, "apps/web/.env.example"),
  );
  copyFileSync(join(CWD, "package.json"), join(tmpDir, "package.json"));
  writeFileSync(join(tmpDir, "docs", "DEPLOY.md"), deployMdBody);
}

describe("check-deploy-docs", () => {
  it("exits 0 and prints PASS summary for current docs/DEPLOY.md", () => {
    const out = runCheck();
    assert.match(
      out,
      /PASS: docs\/DEPLOY\.md references are consistent/i,
      "expected pass summary",
    );
  });

  it("reports the env header and pnpm command header", () => {
    const out = runCheck();
    assert.match(out, /docs\/DEPLOY\.md -> env references/);
    assert.match(out, /docs\/DEPLOY\.md -> pnpm commands/);
  });

  it("verifies VITE_RPC_URL resolves to apps/web/.env.example", () => {
    const out = runCheck();
    assert.match(out, /\[PASS\]\s+VITE_RPC_URL/);
  });

  it("verifies runtime secrets in root .env.example", () => {
    const out = runCheck();
    for (const v of [
      "KEEPER_SECRET",
      "OPERATOR_SECRET",
      "BIDDER_SECRET",
      "ROUND_CONTRACT_ID",
      "FACILITATOR_SECRET",
      "PAY_TO",
      "X402_NETWORK",
      "PRICE",
      "PORT",
      "MAINNET_CONFIRM",
    ]) {
      assert.match(out, new RegExp(`\\[PASS\\]\\s+${v}\\b`), `expected ${v} to pass`);
    }
  });

  it("verifies mainnet scripts and keeper watch command", () => {
    const out = runCheck();
    for (const c of [
      "pnpm mainnet:ready",
      "pnpm mainnet:verify",
      "pnpm mainnet:micro",
      "pnpm mainnet:deploy",
      "pnpm mainnet:settle",
      "pnpm keeper:watch",
      "pnpm agents:e2e",
      "pnpm appraisal:start",
      "pnpm web:build",
      "pnpm web:dev",
    ]) {
      const re = new RegExp(
        `\\[PASS\\]\\s+${c.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`,
      );
      assert.match(out, re, `expected ${c} to pass`);
    }
  });

  it("FAILs with exit 1 when an env reference cannot be resolved", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "deploy-check-env-"));
    try {
      stageFakeProject(
        tmpDir,
        "# Test\n\n```bash\nTHIS_IS_NOT_A_REAL_VAR=1 pnpm mainnet:ready\n```\n",
      );
      const { failed, output } = runCheckExpectingFailure({
        DEPLOY_DOCS_ROOT: tmpDir,
      });
      assert.equal(failed, true, "expected exit 1 when a referenced env var is unknown");
      assert.match(output, /\[FAIL\]\s+THIS_IS_NOT_A_REAL_VAR/);
      assert.match(output, /FAIL: \d+ inconsistent reference/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("FAILs with exit 1 when a pnpm script reference cannot be resolved", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "deploy-check-cmd-"));
    try {
      // Use only env vars that ARE documented in .env.example so the failure
      // isolates the missing-pnpm-script branch.
      stageFakeProject(
        tmpDir,
        "# Test\n\n```bash\nKEEPER_SECRET=S… pnpm totally:not:a:script\n```\n",
      );
      const { failed, output } = runCheckExpectingFailure({
        DEPLOY_DOCS_ROOT: tmpDir,
      });
      assert.equal(failed, true, "expected exit 1 when a referenced pnpm script is missing");
      assert.match(output, /\[FAIL\]\s+pnpm totally:not:a:script/);
      assert.match(output, /missing in root package\.json `scripts`/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
