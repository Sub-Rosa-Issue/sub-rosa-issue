#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
/**
 * Fail when a tracked `.vscode/tasks.json` asks VS Code to run a task by itself
 * as soon as the folder is opened.
 *
 * `"runOn": "folderOpen"` turns opening the repository into code execution: the
 * task runs before the contributor reads anything, with the workspace's own
 * commands and the repo's checkout as the trigger. The repository should refuse
 * to carry that configuration rather than review it.
 *
 * This scanner deliberately looks for the trigger only. It does not parse the
 * task object, does not resolve or execute a command, and does not echo file
 * contents — the finding is a path and a line number, nothing else.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createLogger } from "../packages/logging/src/index.cjs";
import { normalizeError } from "../packages/logging/src/errors.cjs";

const diagnostics = createLogger("scripts.check-vscode-tasks");

/** VS Code auto-runs a task on folder open with exactly this value. */
const AUTO_RUN_TRIGGER = /"runOn"\s*:\s*"folderOpen"/;

/**
 * True for a VS Code task manifest at the repo root or inside a nested
 * workspace folder, as `git ls-files` reports paths.
 *
 * @param {string} trackedPath
 */
export function isTasksManifest(trackedPath) {
  const segments = trackedPath.split("/");
  return segments.length >= 2 && segments[segments.length - 1] === "tasks.json" &&
    segments[segments.length - 2] === ".vscode";
}

/**
 * @param {string} content
 * @param {string} relPath
 * @returns {{ relPath: string, line: number, problem: string }[]}
 */
export function findAutoRunTriggers(content, relPath) {
  const hits = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (AUTO_RUN_TRIGGER.test(lines[i])) {
      hits.push({
        relPath,
        line: i + 1,
        problem: 'declares "runOn": "folderOpen", which runs a task without anyone asking',
      });
    }
  }
  return hits;
}

/**
 * @param {{ relPath: string, content: string|null }[]} manifests
 * @returns {ReturnType<typeof findAutoRunTriggers>}
 */
export function scanTasksManifests(manifests) {
  /** @type {ReturnType<typeof findAutoRunTriggers>} */
  const found = [];
  for (const manifest of manifests) {
    if (manifest.content === null) {
      // El archivo esta trackeado pero no se puede leer: no se puede afirmar
      // que no auto-ejecuta, asi que se reporta en vez de pasar de largo.
      found.push({ relPath: manifest.relPath, line: 0, problem: "is tracked but cannot be read, so its tasks cannot be verified" });
      continue;
    }
    found.push(...findAutoRunTriggers(manifest.content, manifest.relPath));
  }
  return found;
}

/**
 * @param {string} cwd
 */
export function trackedTaskManifests(cwd = process.cwd()) {
  const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
  }).trim();
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: toplevel,
    encoding: "utf-8",
  })
    .split("\0")
    .filter(Boolean)
    .filter(isTasksManifest);

  return tracked.map((relPath) => {
    let content = null;
    try {
      content = readFileSync(join(toplevel, relPath), "utf-8");
    } catch {
      content = null;
    }
    return { relPath, content };
  });
}

function main() {
  diagnostics.info("vscode-task-guard", "\nVS Code automatic-task guard");
  diagnostics.info("rejecting", `  rejecting: "runOn": "folderOpen" in tracked .vscode/tasks.json`);

  /** @type {ReturnType<typeof scanTasksManifests>} */
  let violations;
  let manifests;
  try {
    manifests = trackedTaskManifests();
    violations = scanTasksManifests(manifests);
  } catch (error) {
    // Sin git no hay forma de saber que esta trackeado; un cheque que no puede
    // responder tiene que fallar, no aprobar.
    violations = [{ relPath: process.cwd(), line: 0, problem: `cannot list tracked files (${normalizeError(error).message.split("\n")[0]})` }];
    manifests = [];
  }

  diagnostics.info("scanned", `  tracked task manifests scanned: ${manifests.length}`);

  if (violations.length === 0) {
    diagnostics.info("pass-no-tracked-vscode-task-runs-on-folder-open", "PASS  no tracked VS Code task runs automatically on folder open.");
    process.exit(0);
  }

  diagnostics.error("fail", `FAIL  ${violations.length} automatic task(s):`);
  for (const v of violations) {
    // Solo ruta y numero de linea: el contenido del task puede llevar secretos,
    // y la razon del cheque es exactamente que nadie ejecute eso.
    diagnostics.error("violation", `  ${v.relPath}${v.line > 0 ? `:${v.line}` : ""}  ${v.problem}`);
  }
  diagnostics.error(
    "delete-the-runon-line-from-the-task-or-let-the-operat",
    '\nRemove the "runOn" line so the operator starts the task deliberately.',
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
