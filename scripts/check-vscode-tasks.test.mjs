// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findAutoRunTriggers,
  isTasksManifest,
  scanTasksManifests,
} from "./check-vscode-tasks.mjs";

const CHECKER = new URL("check-vscode-tasks.mjs", import.meta.url).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** Una ruta que solo aparece dentro del comando: si sale impresa, el guard filtra. */
const COMMAND_MARKER = "MARKER-never-echo-this-command";

const MANUAL_TASK = [
  "{",
  '  "version": "2.0.0",',
  '  "tasks": [',
  "    {",
  '      "label": "sdk:test",',
  '      "type": "shell",',
  '      "command": "pnpm sdk:test",',
  '      "group": "test"',
  "    }",
  "  ]",
  "}",
].join("\n");

const AUTO_RUN_TASK = [
  "{",
  '  "version": "2.0.0",',
  '  "tasks": [',
  "    {",
  '      "label": "bootstrap",',
  '      "type": "shell",',
  '      "command": "' + COMMAND_MARKER + '",',
  '      "runOn": "folderOpen"',
  "    }",
  "  ]",
  "}",
].join("\n");

/** Corre el guard dentro de `cwd` y devuelve exit code mas stdout y stderr juntos. */
function runChecker(cwd) {
  const result = spawnSync("node", [CHECKER], { cwd, encoding: "utf-8" });
  return { code: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
}

/**
 * Repo de mentira con un .vscode/tasks.json trackeado (o no) para probar que la
 * norma es sobre lo que esta en el indice, no sobre lo que hay en disco.
 *
 * @param {{ content: string, track?: boolean }} options
 */
function tempRepo({ content, track = true }) {
  const root = mkdtempSync(join(tmpdir(), "vscode-tasks-"));
  mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, ".vscode", "tasks.json"), content);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "temp", packageManager: "pnpm@10.13.1" }));
  spawnSync("git", ["init", "-q", "."], { cwd: root, encoding: "utf-8" });
  if (track) spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf-8" });
  return root;
}

describe("isTasksManifest", () => {
  it("matches a task manifest at the root and in a nested workspace", () => {
    assert.equal(isTasksManifest(".vscode/tasks.json"), true);
    assert.equal(isTasksManifest("apps/web/.vscode/tasks.json"), true);
  });

  it("ignores other editor files and a bare tasks.json", () => {
    assert.equal(isTasksManifest(".vscode/settings.json"), false);
    assert.equal(isTasksManifest(".vscode/extensions.json"), false);
    assert.equal(isTasksManifest("tasks.json"), false);
    assert.equal(isTasksManifest("docs/CI.md"), false);
  });
});

describe("findAutoRunTriggers", () => {
  it("flags a task that runs on folder open, with its line", () => {
    const hits = findAutoRunTriggers(AUTO_RUN_TASK, ".vscode/tasks.json");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].relPath, ".vscode/tasks.json");
    assert.equal(hits[0].line, 8);
    assert.match(hits[0].problem, /"runOn": "folderOpen"/);
  });

  it("passes a normal manual task", () => {
    assert.deepEqual(findAutoRunTriggers(MANUAL_TASK, ".vscode/tasks.json"), []);
  });

  it("passes an explicit non-auto runOn value", () => {
    const content = '{ "tasks": [{ "label": "a", "runOn": "default" }] }';
    assert.deepEqual(findAutoRunTriggers(content, ".vscode/tasks.json"), []);
  });

  it("flags the trigger regardless of spacing", () => {
    const content = '{"tasks":[{"label":"a","runOn":"folderOpen"}]}';
    const hits = findAutoRunTriggers(content, "apps/web/.vscode/tasks.json");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].relPath, "apps/web/.vscode/tasks.json");
  });

  it("reports the location only, never the task command", () => {
    // La razon de existir del guard es que nadie ejecute ese comando; imprimirlo
    // en el log de CI lo replicaria donde cualquier lector de PR lo ve.
    const hits = findAutoRunTriggers(AUTO_RUN_TASK, ".vscode/tasks.json");
    const rendered = JSON.stringify(hits);
    assert.doesNotMatch(rendered, new RegExp(COMMAND_MARKER));
    assert.deepEqual(Object.keys(hits[0]).sort(), ["line", "problem", "relPath"]);
  });
});

describe("scanTasksManifests", () => {
  it("collects triggers across every tracked manifest", () => {
    const hits = scanTasksManifests([
      { relPath: ".vscode/tasks.json", content: AUTO_RUN_TASK },
      { relPath: "apps/web/.vscode/tasks.json", content: MANUAL_TASK },
    ]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].relPath, ".vscode/tasks.json");
  });

  it("fails closed on a tracked manifest it cannot read", () => {
    const hits = scanTasksManifests([{ relPath: ".vscode/tasks.json", content: null }]);
    assert.equal(hits.length, 1);
    assert.match(hits[0].problem, /cannot be read/);
  });
});

describe("check-vscode-tasks CLI", () => {
  it("passes on this repository, which tracks no task manifest", () => {
    const { code, output } = runChecker(REPO_ROOT);
    assert.equal(code, 0, output);
    assert.match(output, /PASS {2}no tracked VS Code task runs automatically on folder open/);
  });

  it("fails when a tracked fixture contains runOn folderOpen", () => {
    const root = tempRepo({ content: AUTO_RUN_TASK });
    try {
      const { code, output } = runChecker(root);
      assert.notEqual(code, 0, "un task autoejecutado trackeado tiene que dar exit distinto de 0");
      assert.match(output, /\.vscode\/tasks\.json:8/);
      assert.doesNotMatch(output, new RegExp(COMMAND_MARKER), "el guard no puede imprimir el comando");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes a normal manual task fixture", () => {
    const root = tempRepo({ content: MANUAL_TASK });
    try {
      const { code, output } = runChecker(root);
      assert.equal(code, 0, output);
      assert.match(output, /tracked task manifests scanned: 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("audits tracked manifests, not files that merely exist on disk", () => {
    const root = tempRepo({ content: AUTO_RUN_TASK, track: false });
    try {
      const { code, output } = runChecker(root);
      assert.equal(code, 0, output);
      assert.match(output, /tracked task manifests scanned: 0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is runnable from the root package script", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")).scripts;
    assert.equal(scripts["vscode-tasks:check"], "node scripts/check-vscode-tasks.mjs");
    assert.equal(scripts["vscode-tasks:test"], "node --test scripts/check-vscode-tasks.test.mjs");
  });

  it("is wired into the TypeScript coverage workflow", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "coverage.yml"), "utf-8");
    assert.match(workflow, /pnpm vscode-tasks:test && pnpm vscode-tasks:check/);
  });
});
