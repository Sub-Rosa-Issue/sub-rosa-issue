// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findViolations,
  managerName,
  readRepoState,
  rootLockfiles,
} from "./check-root-lockfile.mjs";

const CHECKER = new URL("check-root-lockfile.mjs", import.meta.url).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** Run the checker in `cwd`; report exit code and both streams. */
function runChecker(cwd) {
  const result = spawnSync("node", [CHECKER], { cwd, encoding: "utf-8" });
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Un repositorio de mentira, con el indice de git relleno a mano: lo que se
 * audita son los archivos trackeados, no los que existen en disco.
 *
 * @param {{ packageManager?: string, lockfiles?: string[] }} options
 */
function tempRepo({ packageManager = "pnpm@10.13.1", lockfiles = ["pnpm-lock.yaml"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "root-lockfile-"));
  const pkg = { name: "temp-workspace", version: "0.0.0" };
  if (packageManager !== null) pkg.packageManager = packageManager;
  mkdirSync(join(root, "packages", "sdk"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  for (const lockfile of lockfiles) writeFileSync(join(root, lockfile), "lockfileVersion: 9\n");
  // Un lockfile de workspace no cuenta como lockfile de root.
  writeFileSync(join(root, "packages", "sdk", "package-lock.json"), "{}\n");
  spawnSync("git", ["init", "-q", "."], { cwd: root, encoding: "utf-8" });
  spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf-8" });
  return root;
}

describe("managerName", () => {
  it("reads the manager out of a pinned packageManager field", () => {
    assert.equal(managerName("pnpm@10.13.1"), "pnpm");
    assert.equal(managerName("npm@10.9.2+sha512 abc"), "npm");
  });

  it("returns null when the field cannot name a supported installer", () => {
    assert.equal(managerName(undefined), null);
    assert.equal(managerName(null), null);
    assert.equal(managerName(""), null);
    assert.equal(managerName("deno@2.1"), null);
  });
});

describe("rootLockfiles", () => {
  it("keeps root lockfiles and ignores workspace-level ones", () => {
    assert.deepEqual(
      rootLockfiles([
        "pnpm-lock.yaml",
        "package-lock.json",
        "packages/sdk/package-lock.json",
        "src/app.ts",
      ]),
      ["package-lock.json", "pnpm-lock.yaml"],
    );
  });
});

describe("findViolations", () => {
  it("passes when the declared manager's lockfile is the only root lockfile", () => {
    const violations = findViolations({
      trackedPaths: ["package.json", "pnpm-lock.yaml", "packages/sdk/package-lock.json"],
      packageManager: "pnpm@10.13.1",
    });
    assert.deepEqual(violations, []);
  });

  it("fails when a second root lockfile is tracked", () => {
    const violations = findViolations({
      trackedPaths: ["package-lock.json", "pnpm-lock.yaml"],
      packageManager: "pnpm@10.13.1",
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0].problem, /2 root lockfiles are tracked \(package-lock.json, pnpm-lock.yaml\)/);
    assert.match(violations[0].problem, /only pnpm-lock.yaml may be tracked/);
  });

  it("fails when the only tracked root lockfile belongs to another manager", () => {
    const violations = findViolations({
      trackedPaths: ["package-lock.json"],
      packageManager: "pnpm@10.13.1",
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0].problem, /the root tracks package-lock.json/);
    assert.match(violations[0].problem, /whose root lockfile is pnpm-lock.yaml/);
  });

  it("fails when no root lockfile is tracked at all", () => {
    const violations = findViolations({ trackedPaths: ["README.md"], packageManager: "pnpm@10.13.1" });
    assert.equal(violations.length, 1);
    assert.match(violations[0].problem, /tracks no lockfile/);
  });

  it("fails when packageManager does not name a supported installer", () => {
    // Sin esta linea el cheque tendria que elegir un lockfile por defecto y
    // daria una senal verde que nadie pidio.
    const violations = findViolations({
      trackedPaths: ["pnpm-lock.yaml"],
      packageManager: undefined,
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0].problem, /"packageManager" is missing/);
    assert.match(violations[0].problem, /cannot be determined/);
  });
});

describe("readRepoState", () => {
  it("reads tracked paths relative to the repo root from a nested cwd", () => {
    const root = tempRepo();
    try {
      const state = readRepoState(join(root, "packages", "sdk"));
      assert.equal(state.toplevel, root.replace(/\/$/, ""));
      assert.equal(state.packageManager, "pnpm@10.13.1");
      assert.deepEqual(rootLockfiles(state.trackedPaths), ["pnpm-lock.yaml"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-root-lockfile CLI", () => {
  it("passes on this repository", () => {
    const { code, output } = runChecker(REPO_ROOT);
    assert.equal(code, 0, output);
    assert.match(output, /PASS {2}exactly one supported root lockfile is tracked/);
  });

  it("fails when a workspace also tracks a root npm lockfile", () => {
    const root = tempRepo({ lockfiles: ["pnpm-lock.yaml", "package-lock.json"] });
    try {
      const { code, output } = runChecker(root);
      assert.notEqual(code, 0, "dos lockfiles de root tienen que dar exit distinto de 0");
      assert.match(output, /package-lock.json/);
      assert.match(output, /pnpm-lock.yaml/);
      // El lockfile de un workspace no puede arrastrar el fallo.
      assert.doesNotMatch(output, /packages\/sdk\/package-lock\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails loudly when there is no git repository to audit", () => {
    const outside = mkdtempSync(join(tmpdir(), "root-lockfile-no-git-"));
    writeFileSync(join(outside, "package.json"), JSON.stringify({ packageManager: "pnpm@10.13.1" }));
    try {
      const { code, output } = runChecker(outside);
      assert.notEqual(code, 0, "un audit que no puede leer el indice no puede terminar en 0");
      assert.match(output, /cannot read the tracked file list/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("is runnable from the root package script", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")).scripts;
    assert.equal(scripts["lockfile:check"], "node scripts/check-root-lockfile.mjs");
    assert.equal(scripts["lockfile:test"], "node --test scripts/check-root-lockfile.test.mjs");
  });

  it("is wired into the TypeScript coverage workflow", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "coverage.yml"), "utf-8");
    assert.match(workflow, /pnpm lockfile:test && pnpm lockfile:check/);
  });
});
