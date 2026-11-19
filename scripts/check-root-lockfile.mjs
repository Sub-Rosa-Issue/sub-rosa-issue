#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
/**
 * Fail when the repository root tracks a lockfile that does not belong to the
 * package manager declared in package.json, or tracks more than one lockfile.
 *
 * Two lockfiles at one root resolve two dependency graphs, so CI, a
 * contributor's machine and the publish step can each install something
 * different. pnpm is the declared installer here, so pnpm-lock.yaml is the only
 * root lockfile that may be tracked.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createLogger } from "../packages/logging/src/index.cjs";
import { normalizeError } from "../packages/logging/src/errors.cjs";

const diagnostics = createLogger("scripts.check-root-lockfile");

/** Lockfile names a supported package manager writes at a repository root. */
export const ROOT_LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

/** Which root lockfile each declared package manager owns. */
export const LOCKFILE_BY_MANAGER = {
  pnpm: "pnpm-lock.yaml",
  npm: "package-lock.json",
  yarn: "yarn.lock",
  bun: "bun.lock",
};

/**
 * `"pnpm@10.13.1"` -> `"pnpm"`. Anything empty, malformed or unsupported becomes
 * null: a guard that cannot tell which installer owns the root must not pass.
 *
 * @param {unknown} packageManager
 */
export function managerName(packageManager) {
  if (typeof packageManager !== "string") return null;
  const name = packageManager.split("@")[0].trim().toLowerCase();
  return Object.hasOwn(LOCKFILE_BY_MANAGER, name) ? name : null;
}

/**
 * The root-level lockfiles among tracked repository paths. Paths arrive relative
 * to the repository root with forward slashes, as `git ls-files` reports them,
 * so a workspace's own lockfile never counts as a root one.
 *
 * @param {string[]} trackedPaths
 */
export function rootLockfiles(trackedPaths) {
  return trackedPaths.filter((p) => ROOT_LOCKFILES.includes(p)).sort();
}

/**
 * @param {{ trackedPaths: string[], packageManager: unknown }} state
 * @returns {{ problem: string }[]}
 */
export function findViolations({ trackedPaths, packageManager }) {
  const present = rootLockfiles(trackedPaths);
  const manager = managerName(packageManager);

  if (manager === null) {
    const shown = packageManager === undefined ? "missing" : JSON.stringify(packageManager);
    return [
      {
        problem:
          `package.json "packageManager" is ${shown}, which is not one of ` +
          `${Object.keys(LOCKFILE_BY_MANAGER).join(", ")}: the supported root lockfile cannot be determined.`,
      },
    ];
  }

  const supported = LOCKFILE_BY_MANAGER[manager];

  if (present.length === 0) {
    return [
      {
        problem: `the repository root tracks no lockfile; packageManager declares ${manager}, so ${supported} must be tracked.`,
      },
    ];
  }

  if (present.length > 1) {
    return [
      {
        problem:
          `${present.length} root lockfiles are tracked (${present.join(", ")}); ` +
          `only ${supported} may be tracked, because a second lockfile resolves a second dependency graph.`,
      },
    ];
  }

  if (present[0] !== supported) {
    return [
      {
        problem:
          `the root tracks ${present[0]}, but packageManager declares ${manager}, whose root lockfile ` +
          `is ${supported}. Install with ${manager} and remove ${present[0]}.`,
      },
    ];
  }

  return [];
}

/**
 * @param {string} cwd
 */
export function readRepoState(cwd = process.cwd()) {
  const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
  }).trim();
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: toplevel,
    encoding: "utf-8",
  })
    .split("\0")
    .filter(Boolean);
  const packageManager = JSON.parse(
    readFileSync(join(toplevel, "package.json"), "utf-8"),
  ).packageManager;
  return { toplevel, trackedPaths, packageManager };
}

function main() {
  diagnostics.info("root-lockfile-guard", "\nRoot lockfile guard");
  diagnostics.info("supported", `  supported root lockfiles: ${ROOT_LOCKFILES.join(", ")}`);

  /** @type {{ problem: string }[]} */
  let violations;
  try {
    const state = readRepoState();
    diagnostics.info("repo-root", `  repo root: ${state.toplevel}`);
    diagnostics.info("declared", `  declared packageManager: ${JSON.stringify(state.packageManager)}`);
    diagnostics.info(
      "tracked",
      `  tracked root lockfiles: ${rootLockfiles(state.trackedPaths).join(", ") || "(none)"}`,
    );
    violations = findViolations(state);
  } catch (error) {
    // Sin git, o sin package.json legible, el root no se puede auditar: terminar
    // en 0 aqui seria un aprobado silencioso del cheque roto.
    violations = [{ problem: `cannot read the tracked file list (${normalizeError(error).message.split("\n")[0]})` }];
  }

  if (violations.length === 0) {
    diagnostics.info("pass-exactly-one-supported-root-lockfile-is-tracked", "PASS  exactly one supported root lockfile is tracked.");
    process.exit(0);
  }

  diagnostics.error("fail", `FAIL  ${violations.length} problem(s):`);
  for (const v of violations) diagnostics.error("problem", `  ${v.problem}`);
  diagnostics.error(
    "git-rm-the-extra-lockfile-then-install-with-the-declar",
    "\nRemove the extra lockfile with `git rm`, then install with the package manager declared in package.json.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
