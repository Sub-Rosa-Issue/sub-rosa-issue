// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CHECKER = new URL("check-workflow-credentials.mjs", import.meta.url).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname;

function run(repoRoot) {
  try {
    const stdout = execFileSync("node", [CHECKER, repoRoot], { encoding: "utf-8" });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "" };
  }
}

/** Create a temp repo skeleton with the given workflow files. */
function fakeRepo(workflows) {
  const raiz = mkdtempSync(join(tmpdir(), "wf-cred-"));
  const wfDir = join(raiz, ".github", "workflows");
  mkdirSync(wfDir, { recursive: true });
  for (const [name, content] of Object.entries(workflows)) {
    writeFileSync(join(wfDir, name), content);
  }
  return raiz;
}

const GOOD_WORKFLOW = [
  "name: Good",
  "on: [push]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      # Read-only workflow: downstream steps do not push",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          persist-credentials: false",
  "      - run: echo hi",
  "",
].join("\n");

const BAD_WORKFLOW = [
  "name: Bad",
  "on: [push]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - run: echo hi",
  "",
].join("\n");

const PARTIAL_WORKFLOW = [
  "name: Partial",
  "on: [push]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      # Read-only workflow: downstream steps do not push",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          persist-credentials: false",
  "      - run: echo first",
  "      - uses: actions/checkout@v4",
  "      - run: echo second",
  "",
].join("\n");

describe("check-workflow-credentials", () => {
  it("passes on the real repository — all checkout steps have persist-credentials: false", () => {
    const { code, stdout } = run(REPO_ROOT);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /persist-credentials: false on every checkout step/);
  });

  it("passes when all checkout steps have persist-credentials: false", () => {
    const raiz = fakeRepo({ "good.yml": GOOD_WORKFLOW });
    try {
      const { code, stdout } = run(raiz);
      assert.equal(code, 0, stdout);
      assert.match(stdout, /1 workflow file\(s\)/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("fails when a checkout step is missing persist-credentials: false", () => {
    const raiz = fakeRepo({ "bad.yml": BAD_WORKFLOW });
    try {
      const { code, stdout } = run(raiz);
      assert.notEqual(code, 0);
      assert.match(stdout, /bad\.yml:9/);
      assert.match(stdout, /persist-credentials: false/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("catches the second checkout when only the first has persist-credentials: false", () => {
    const raiz = fakeRepo({ "partial.yml": PARTIAL_WORKFLOW });
    try {
      const { code, stdout } = run(raiz);
      assert.notEqual(code, 0);
      assert.match(stdout, /partial\.yml:14/);
      assert.doesNotMatch(stdout, /partial\.yml:8/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("passes when there are no workflow files", () => {
    const raiz = mkdtempSync(join(tmpdir(), "wf-empty-"));
    try {
      const { code, stdout } = run(raiz);
      assert.equal(code, 0);
      assert.match(stdout, /0 workflow file\(s\)/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
