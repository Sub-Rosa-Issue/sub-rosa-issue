// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseNodeMajor,
  verifyNodeVersionConsistency,
} from "./check-node-version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function createFixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "sub-rosa-node-version-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
  return root;
}

describe("check-node-version", () => {
  it("extracts major versions from common pin and engine formats", () => {
    assert.equal(parseNodeMajor("22"), "22");
    assert.equal(parseNodeMajor("22.14.0"), "22");
    assert.equal(parseNodeMajor("v22.14.0"), "22");
    assert.equal(parseNodeMajor(">=22"), "22");
    assert.equal(parseNodeMajor("^22.0.0"), "22");
    assert.equal(parseNodeMajor("invalid"), null);
  });

  it("passes on the real repository", () => {
    const result = verifyNodeVersionConsistency(REPO_ROOT);
    assert.equal(result.ok, true, `Unexpected issues: ${result.issues.join("; ")}`);
    assert.equal(result.expectedMajor, "22");
  });

  it("fails when .nvmrc and .node-version are both missing", () => {
    const root = createFixtureRepo({
      "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    });
    try {
      const result = verifyNodeVersionConsistency(root);
      assert.equal(result.ok, false);
      assert.match(result.issues[0], /Missing Node version file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when package.json engines.node disagrees with .nvmrc", () => {
    const root = createFixtureRepo({
      ".nvmrc": "22\n",
      "package.json": JSON.stringify({ engines: { node: ">=20" } }),
    });
    try {
      const result = verifyNodeVersionConsistency(root);
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((msg) => msg.includes("engines.node")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a workflow setup-node step disagrees with .nvmrc", () => {
    const root = createFixtureRepo({
      ".nvmrc": "22\n",
      "package.json": JSON.stringify({ engines: { node: ">=22" } }),
      ".github/workflows/ci.yml": [
        "jobs:",
        "  test:",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "20"',
      ].join("\n"),
    });
    try {
      const result = verifyNodeVersionConsistency(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((msg) =>
          msg.includes(".github/workflows/ci.yml:6 node-version"),
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
