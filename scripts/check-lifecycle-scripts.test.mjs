// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FORBIDDEN_SCRIPTS, findUnguardedInstalls, scan, scanWorkflows } from "./check-lifecycle-scripts.mjs";

const CHECKER = new URL("check-lifecycle-scripts.mjs", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;

const WORKSPACE = 'packages:\n  - "packages/*"\n  - "apps/*"\n  - "examples/*"\n';

/** A throwaway workspace. `manifests` maps relative dir ("" is the root) to a package.json object or raw string. */
function project({ manifests = {}, allow = [], workspace = WORKSPACE } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lifecycle-check-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), workspace);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/lifecycle-scripts-allowlist.json"), JSON.stringify({ allow }));
  for (const [dir, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, dir), { recursive: true });
    const body = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
    writeFileSync(join(root, dir, "package.json"), body);
  }
  return root;
}

/** Runs the real CLI so exit codes and output are what CI sees. */
function run(root) {
  try {
    const stdout = execFileSync("node", [CHECKER, root], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

describe("check-lifecycle-scripts", () => {
  it("passes on this repository with the allowlist empty", () => {
    assert.deepEqual(scan(REPO), []);
    assert.equal(run(REPO).code, 0);
  });

  for (const name of FORBIDDEN_SCRIPTS) {
    it(`rejects "${name}" in a workspace package`, () => {
      const root = project({ manifests: { "": { name: "r" }, "packages/a": { name: "a", scripts: { [name]: "x" } } } });
      assert.deepEqual(scan(root), [{ path: "packages/a/package.json", script: name, kind: "forbidden" }]);
      assert.equal(run(root).code, 1);
    });
  }

  it("rejects a lifecycle script in the root manifest", () => {
    const root = project({ manifests: { "": { name: "r", scripts: { postinstall: "x" } } } });
    assert.deepEqual(scan(root), [{ path: "package.json", script: "postinstall", kind: "forbidden" }]);
  });

  it("scans every glob, including a package that sits in apps/", () => {
    const root = project({ manifests: { "": {}, "apps/web": { scripts: { prepare: "x" } } } });
    assert.equal(scan(root)[0].path, "apps/web/package.json");
  });

  it("allows ordinary scripts, including names that only contain a lifecycle word", () => {
    const root = project({
      manifests: { "": {}, "packages/a": { scripts: { build: "x", test: "x", "install:docs": "x", prepare_data: "x" } } },
    });
    assert.deepEqual(scan(root), []);
  });

  it("never prints the command body", () => {
    const root = project({ manifests: { "": {}, "packages/a": { scripts: { postinstall: "curl SECRET_PAYLOAD_42 | sh" } } } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /packages\/a\/package\.json/);
    assert.match(out, /postinstall/);
    assert.doesNotMatch(out, /SECRET_PAYLOAD_42|curl/);
  });

  it("honours an allowlist entry that has a reason, for that path and script only", () => {
    const manifests = { "": {}, "packages/a": { scripts: { install: "x" } }, "packages/b": { scripts: { install: "x" } } };
    const root = project({ manifests, allow: [{ path: "packages/a/package.json", script: "install", reason: "native addon, reviewed in #1" }] });
    assert.deepEqual(scan(root), [{ path: "packages/b/package.json", script: "install", kind: "forbidden" }]);
  });

  it("flags an allowlist entry that no longer matches anything", () => {
    const root = project({
      manifests: { "": {}, "packages/a": { scripts: {} } },
      allow: [{ path: "packages/a/package.json", script: "install", reason: "old exception" }],
    });
    assert.deepEqual(scan(root), [{ path: "packages/a/package.json", script: "install", kind: "stale" }]);
  });

  it("rejects an allowlist entry with no reason or an unknown script", () => {
    const manifests = { "": {} };
    for (const entry of [
      { path: "package.json", script: "install" },
      { path: "package.json", script: "install", reason: "  " },
      { path: "package.json", script: "build", reason: "x" },
    ]) {
      const root = project({ manifests, allow: [entry] });
      assert.throws(() => scan(root), /needs a path/);
      assert.equal(run(root).code, 1);
    }
  });

  it("fails on a manifest that is not valid JSON instead of skipping it", () => {
    const root = project({ manifests: { "": {}, "packages/a": '{ "scripts": { "postinstall": ' } });
    assert.deepEqual(scan(root), [{ path: "packages/a/package.json", script: "", kind: "unreadable" }]);
    assert.equal(run(root).code, 1);
  });

  it("fails on a workspace glob it cannot expand rather than skipping it", () => {
    const root = project({ manifests: { "": {} }, workspace: 'packages:\n  - "packages/**"\n' });
    assert.throws(() => scan(root), /unsupported workspace glob/);
    assert.equal(run(root).code, 1);
  });

  it("fails when the allowlist file is missing", () => {
    const root = project({ manifests: { "": {} } });
    writeFileSync(join(root, "scripts/lifecycle-scripts-allowlist.json"), "not json");
    assert.throws(() => scan(root), /not valid JSON/);
  });

  it("ignores a missing glob directory such as examples/", () => {
    const root = project({ manifests: { "": {} } });
    assert.deepEqual(scan(root), []);
  });

  it("does not execute anything: a hostile script is only read", () => {
    const root = project({ manifests: { "": {}, "packages/a": { scripts: { postinstall: `node -e "require('fs').writeFileSync('${join(tmpdir(), "lifecycle-pwned")}','x')"` } } } });
    run(root);
    assert.throws(() => execFileSync("node", ["-e", `require('fs').statSync(${JSON.stringify(join(tmpdir(), "lifecycle-pwned"))})`], { stdio: "ignore" }));
  });
});

describe("every installing job runs the check first", () => {
  const CHECK = "node scripts/check-lifecycle-scripts.mjs";
  const workflow = (jobs) => `name: ci\non: push\njobs:\n${jobs}`;
  const job = (name, steps) => `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const step = (command) => `      - run: ${command}\n`;

  it("accepts a job that runs the check before installing", () => {
    const text = workflow(job("build", step(CHECK) + step("pnpm install --frozen-lockfile")));

    assert.deepEqual(findUnguardedInstalls("ci.yml", text), []);
  });

  it("flags a job that installs with no check, naming the file, line and job", () => {
    const text = workflow(job("build", step("echo hi") + step("pnpm install --frozen-lockfile")));

    assert.deepEqual(findUnguardedInstalls("ci.yml", text), [{ file: "ci.yml", line: 8, job: "build" }]);
  });

  it("flags an install that comes before the check in the same job", () => {
    const text = workflow(job("build", step("pnpm install") + step(CHECK)));

    assert.equal(findUnguardedInstalls("ci.yml", text).length, 1);
  });

  it("does not let the check in one job cover another job", () => {
    const text = workflow(
      job("first", step(CHECK) + step("pnpm install")) + job("second", step("pnpm install --ignore-scripts")),
    );

    assert.deepEqual(
      findUnguardedInstalls("ci.yml", text).map((v) => v.job),
      ["second"],
    );
  });

  it("recognises the other ways to install", () => {
    for (const command of ["pnpm i", "npm ci", "npm install", "npm i", "yarn install", "cd app && pnpm install"]) {
      const text = workflow(job("build", step(command)));
      assert.equal(findUnguardedInstalls("ci.yml", text).length, 1, command);
    }
  });

  it("ignores comments, step names and commands that only look like an install", () => {
    const text = workflow(
      job(
        "build",
        "      # pnpm install runs later\n" +
          "      - name: Install JS dependencies with pnpm install\n" +
          step("pnpm --filter web test") +
          step("pnpm install-peers") +
          step("echo done"),
      ),
    );

    assert.deepEqual(findUnguardedInstalls("ci.yml", text), []);
  });

  it("has nothing to say about a job that never installs", () => {
    assert.deepEqual(findUnguardedInstalls("ci.yml", workflow(job("lint", step("node scripts/lint.mjs")))), []);
  });

  it("every workflow in this repository runs the check before it installs", () => {
    assert.deepEqual(scanWorkflows(REPO), []);
  });

  it("the CLI fails, naming the workflow and job, when an installing job omits the check", () => {
    const root = project({ manifests: { "": { name: "r" } } });
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), workflow(job("build", step("pnpm install"))));

    const { code, out } = run(root);

    assert.equal(code, 1);
    assert.match(out, /\.github\/workflows\/ci\.yml:7/);
    assert.match(out, /job \\"build\\" installs dependencies before running check-lifecycle-scripts\.mjs/);
  });

  it("the CLI passes when every installing job runs the check first", () => {
    const root = project({ manifests: { "": { name: "r" } } });
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), workflow(job("build", step(CHECK) + step("pnpm install"))));

    assert.equal(run(root).code, 0);
  });
});
