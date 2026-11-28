#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
/**
 * Fail when a tracked VS Code task manifest asks the editor to run a task by
 * itself as soon as its folder is opened.
 *
 * `"runOn": "folderOpen"` turns opening the repository into code execution: the
 * task runs before the contributor reads anything, with the workspace's own
 * commands and the repo's checkout as the trigger. The repository should refuse
 * to carry that configuration rather than review it.
 *
 * Scope: every tracked `.vscode/tasks.json` — at the root or inside a nested
 * workspace folder — and every tracked `*.code-workspace` file, because a
 * multi-root workspace makes the task manifests of the folders it lists run as
 * workspace tasks.
 *
 * Both are JSONC, so comments and trailing commas are legal and the trigger may
 * be split over several lines:
 *
 *     "runOn":
 *       // the value VS Code treats as "start this when the folder opens"
 *       "folderOpen"
 *
 * The manifest is tokenized rather than matched line by line, so formatting does
 * not decide whether the guard sees the trigger. It reports a path and a line
 * only: it never resolves, executes or echoes a task command.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createLogger } from "../packages/logging/src/index.cjs";
import { normalizeError } from "../packages/logging/src/errors.cjs";

const diagnostics = createLogger("scripts.check-vscode-tasks");

/** VS Code auto-runs a task on folder open with exactly this value. */
const AUTO_RUN_KEY = "runOn";
const AUTO_RUN_VALUE = "folderOpen";

/**
 * True for a tracked VS Code task manifest: `.vscode/tasks.json` at any depth,
 * or a multi-root `*.code-workspace` file at any depth, as `git ls-files`
 * reports paths.
 *
 * @param {string} trackedPath
 */
export function isTasksManifest(trackedPath) {
  const segments = trackedPath.split("/");
  const name = segments[segments.length - 1];
  if (name.endsWith(".code-workspace")) return true;
  return segments.length >= 2 && name === "tasks.json" && segments[segments.length - 2] === ".vscode";
}

/**
 * Split JSONC into the tokens this scan needs, keeping the line each token
 * starts on. Comments are dropped, so a commented-out trigger is not a
 * finding, and string values are decoded, so an escaped `\"runOn\"` inside a
 * task command is not mistaken for a key.
 *
 * @param {string} source
 * @returns {{
 *   tokens: { type: "string" | "punct" | "literal", value: string, line: number }[],
 *   error: { line: number, message: string } | null,
 * }}
 */
export function tokenizeJsonc(source) {
  /** @type {{ type: "string" | "punct" | "literal", value: string, line: number }[]} */
  const tokens = [];
  let line = 1;
  let i = 0;

  /** @param {string} message @param {number} atLine */
  const fail = (message, atLine) => ({ tokens, error: { line: atLine, message } });

  while (i < source.length) {
    const char = source[i];

    if (char === "\n") {
      line++;
      i++;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r" || char === "\uFEFF") {
      i++;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      const startLine = line;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      if (i >= source.length) return fail("an unterminated /* comment", startLine);
      i += 2;
      continue;
    }

    if (char === '"') {
      const startLine = line;
      let value = "";
      let closed = false;
      i++;
      while (i < source.length) {
        const current = source[i];
        if (current === '"') {
          i++;
          closed = true;
          break;
        }
        if (current === "\n") break;
        if (current === "\\") {
          const escape = source[i + 1];
          if (escape === undefined) break;
          if (escape === "u") {
            const hex = source.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("an invalid \\u escape", line);
            value += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          const simple = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
          };
          if (!Object.hasOwn(simple, escape)) return fail(`an invalid \\${escape} escape`, line);
          value += simple[escape];
          i += 2;
          continue;
        }
        value += current;
        i++;
      }
      if (!closed) return fail("an unterminated string", startLine);
      tokens.push({ type: "string", value, line: startLine });
      continue;
    }

    if ("{}[]:,".includes(char)) {
      tokens.push({ type: "punct", value: char, line });
      i++;
      continue;
    }

    const start = i;
    while (
      i < source.length &&
      !/[\s{}\[\]:,"]/.test(source[i]) &&
      !(source[i] === "/" && (source[i + 1] === "/" || source[i + 1] === "*"))
    ) {
      i++;
    }
    if (i === start) return fail(`an unexpected character ${JSON.stringify(char)}`, line);
    tokens.push({ type: "literal", value: source.slice(start, i), line });
  }

  return { tokens, error: null };
}

/**
 * A manifest that cannot be tokenized cannot be cleared, so it is reported as a
 * finding — the guard fails closed instead of passing a file it could not read.
 *
 * @param {string} content
 * @param {string} relPath
 * @returns {{ relPath: string, line: number, problem: string }[]}
 */
export function findAutoRunTriggers(content, relPath) {
  const { tokens, error } = tokenizeJsonc(content);
  if (error) {
    return [
      {
        relPath,
        line: error.line,
        problem: `is not readable as JSONC (${error.message}), so its tasks cannot be verified`,
      },
    ];
  }

  /** @type {{ relPath: string, line: number, problem: string }[]} */
  const hits = [];
  for (let i = 0; i + 2 < tokens.length; i++) {
    const key = tokens[i];
    const colon = tokens[i + 1];
    const value = tokens[i + 2];
    if (
      key.type === "string" &&
      key.value === AUTO_RUN_KEY &&
      colon.type === "punct" &&
      colon.value === ":" &&
      value.type === "string" &&
      value.value === AUTO_RUN_VALUE
    ) {
      hits.push({
        relPath,
        line: key.line,
        problem: `declares "${AUTO_RUN_KEY}": "${AUTO_RUN_VALUE}", which runs a task without anyone asking`,
      });
      i += 2;
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
  diagnostics.info(
    "rejecting",
    `  rejecting: "${AUTO_RUN_KEY}": "${AUTO_RUN_VALUE}" in tracked .vscode/tasks.json or *.code-workspace manifests`,
  );

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
