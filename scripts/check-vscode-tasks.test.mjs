// Copyright (c) 2026 Sub Rosa contributors
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findAutoRunTriggers,
  isTasksManifest,
  scanTasksManifests,
  tokenizeJsonc,
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

/**
 * El mismo trigger, con el formato que VS Code acepta y que un match por linea
 * no ve: JSONC, comentarios, coma final y la clave separada de su valor.
 */
const MULTILINE_JSONC_AUTO_RUN_TASK = [
  "{",
  "  // tasks.json es JSONC: los comentarios y la coma final son legales.",
  '  "version": "2.0.0",',
  '  "tasks": [',
  "    {",
  '      "label": "bootstrap",',
  '      "type": "shell",',
  '      "command": "' + COMMAND_MARKER + '",',
  '      "runOn":',
  "        /* se ejecuta al abrir la carpeta */",
  '        "folderOpen",',
  "    },",
  "  ],",
  "}",
].join("\n");

/** Corre el guard dentro de `cwd` y devuelve exit code mas stdout y stderr juntos. */
function runChecker(cwd) {
  const result = spawnSync("node", [CHECKER], { cwd, encoding: "utf-8" });
  return { code: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
}

/**
 * Repo de mentira con un manifiesto de editor trackeado (o no) para probar que
 * la norma es sobre lo que esta en el indice, no sobre lo que hay en disco.
 *
 * @param {{ content: string, track?: boolean, manifestPath?: string }} options
 */
function tempRepo({ content, track = true, manifestPath = ".vscode/tasks.json" }) {
  const root = mkdtempSync(join(tmpdir(), "vscode-tasks-"));
  mkdirSync(dirname(join(root, manifestPath)), { recursive: true });
  writeFileSync(join(root, manifestPath), content);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "temp", packageManager: "pnpm@10.13.1" }));
  spawnSync("git", ["init", "-q", "."], { cwd: root, encoding: "utf-8" });
  if (track) spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf-8" });
  return root;
}

/**
 * El bloque de un job del workflow, sin depender de que sea el ultimo del
 * archivo.
 *
 * @param {string} workflow
 * @param {string} name
 */
function jobBlock(workflow, name) {
  return (
    workflow
      .split(/^  (?=[a-z][\w-]*:$)/m)
      .find((section) => section.startsWith(`${name}:`)) ?? null
  );
}

describe("isTasksManifest", () => {
  it("matches a task manifest at the root and in a nested workspace", () => {
    assert.equal(isTasksManifest(".vscode/tasks.json"), true);
    assert.equal(isTasksManifest("apps/web/.vscode/tasks.json"), true);
    assert.equal(isTasksManifest("packages/sdk/.vscode/tasks.json"), true);
    assert.equal(isTasksManifest("services/keeper/deep/.vscode/tasks.json"), true);
  });

  it("matches a multi-root workspace manifest at the root and nested", () => {
    assert.equal(isTasksManifest("sub-rosa.code-workspace"), true);
    assert.equal(isTasksManifest("apps/web/team.code-workspace"), true);
  });

  it("ignores other editor files and a bare tasks.json", () => {
    assert.equal(isTasksManifest(".vscode/settings.json"), false);
    assert.equal(isTasksManifest(".vscode/extensions.json"), false);
    assert.equal(isTasksManifest("tasks.json"), false);
    assert.equal(isTasksManifest("docs/CI.md"), false);
  });
});

describe("tokenizeJsonc", () => {
  it("drops comments and recomputes lines across them", () => {
    const { tokens, error } = tokenizeJsonc('{\n  // a\n  /* b\n c */\n  "runOn": "folderOpen"\n}\n');
    assert.equal(error, null);
    const key = tokens.find((token) => token.value === "runOn");
    assert.equal(key?.line, 5);
  });

  it("decodes escapes so an escaped quote does not end a string", () => {
    const { tokens, error } = tokenizeJsonc('{ "command": "echo \\"runOn\\": \\"folderOpen\\"" }');
    assert.equal(error, null);
    assert.equal(tokens.filter((token) => token.type === "string" && token.value === "runOn").length, 0);
  });

  it("reports an unterminated block comment instead of guessing", () => {
    const { error } = tokenizeJsonc('{ /* "runOn": "folderOpen"');
    assert.ok(error);
    assert.match(error.message, /unterminated \/\* comment/);
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

  it("flags a JSONC manifest whose trigger spans several lines", () => {
    const hits = findAutoRunTriggers(MULTILINE_JSONC_AUTO_RUN_TASK, "packages/sdk/.vscode/tasks.json");
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].relPath, "packages/sdk/.vscode/tasks.json");
    assert.equal(hits[0].line, 9);
  });

  it("does not treat a commented-out trigger as a trigger", () => {
    const content = [
      "{",
      '  // "runOn": "folderOpen",',
      '  /* "runOn": "folderOpen" */',
      '  "tasks": [{ "label": "a" }]',
      "}",
    ].join("\n");
    assert.deepEqual(findAutoRunTriggers(content, ".vscode/tasks.json"), []);
  });

  it("does not treat the trigger inside a command string as a trigger", () => {
    const content = [
      "{",
      '  "tasks": [{',
      '    "label": "a",',
      '    "command": "echo \\"runOn\\": \\"folderOpen\\""',
      "  }]",
      "}",
    ].join("\n");
    assert.deepEqual(findAutoRunTriggers(content, ".vscode/tasks.json"), []);
  });

  it("fails closed when a manifest cannot be tokenized as JSONC", () => {
    const broken = findAutoRunTriggers('{ "tasks": [ /* unclosed', "apps/web/.vscode/tasks.json");
    assert.equal(broken.length, 1, JSON.stringify(broken));
    assert.match(broken[0].problem, /cannot be verified/);
    assert.equal(broken[0].line, 1);
  });

  it("reports the location only, never the task command", () => {
    // La razon de existir del guard es que nadie ejecute ese comando; imprimirlo
    // en el log de CI lo replicaria donde cualquier lector de PR lo ve.
    const hits = findAutoRunTriggers(MULTILINE_JSONC_AUTO_RUN_TASK, ".vscode/tasks.json");
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
      { relPath: "packages/sdk/.vscode/tasks.json", content: MULTILINE_JSONC_AUTO_RUN_TASK },
    ]);
    assert.equal(hits.length, 2);
    assert.deepEqual(
      hits.map((hit) => hit.relPath),
      [".vscode/tasks.json", "packages/sdk/.vscode/tasks.json"],
    );
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

  it("fails on a multi-line JSONC trigger in a nested workspace manifest", () => {
    const root = tempRepo({
      content: MULTILINE_JSONC_AUTO_RUN_TASK,
      manifestPath: "packages/sdk/.vscode/tasks.json",
    });
    try {
      const { code, output } = runChecker(root);
      assert.notEqual(code, 0, "un trigger multilinea tiene que dar exit distinto de 0");
      assert.match(output, /packages\/sdk\/\.vscode\/tasks\.json:9/);
      assert.match(output, /tracked task manifests scanned: 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails on a nested multi-root workspace manifest", () => {
    const root = tempRepo({
      content: MULTILINE_JSONC_AUTO_RUN_TASK,
      manifestPath: "apps/web/team.code-workspace",
    });
    try {
      const { code, output } = runChecker(root);
      assert.notEqual(code, 0, "un workspace manifest anidado tiene que revisarse");
      assert.match(output, /apps\/web\/team\.code-workspace:9/);
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

  it("is its own blocking job in the repository guards workflow", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "repo-guards.yml"), "utf-8");
    const job = jobBlock(workflow, "editor-auto-run-tasks");
    assert.ok(job, "editor-auto-run-tasks job must exist");
    assert.doesNotMatch(job, /\bcontinue-on-error\s*:/, "the editor guard must block on failure");
    assert.match(job, /^        run: pnpm vscode-tasks:test$/m);
    assert.match(job, /^        run: pnpm vscode-tasks:check$/m);
    // La politica del lockfile es otro job: un fallo no puede tapar al otro.
    assert.doesNotMatch(job, /lockfile/);
  });
});
