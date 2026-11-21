#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
//
// Rejects install-time lifecycle scripts in workspace package.json files.
//
// A lifecycle script runs automatically during `pnpm install`, so adding one
// later would create a new execution path on every contributor machine and CI
// runner. This check reads JSON only. It never runs a script, never shells
// out, and never prints a script body: findings carry the manifest path and
// the script name and nothing else.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

export const FORBIDDEN_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
];

export const ALLOWLIST_PATH = "scripts/lifecycle-scripts-allowlist.json";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Package globs from pnpm-workspace.yaml.
 *
 * Only the `packages:` list is read, and only `dir/*` or literal `dir`
 * entries are understood. Anything fancier (`**`, negation) throws instead of
 * being skipped, because a skipped glob would leave manifests unchecked.
 */
export function readWorkspaceGlobs(root) {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) throw new Error("pnpm-workspace.yaml is missing");
  const globs = [];
  let inPackages = false;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break;
    const item = line.match(/^\s+-\s+["']?([^"']+?)["']?\s*$/);
    if (item) globs.push(item[1]);
    else if (line.trim() !== "") throw new Error(`unsupported line in pnpm-workspace.yaml packages list`);
  }
  if (globs.length === 0) throw new Error("pnpm-workspace.yaml lists no packages");
  for (const glob of globs) {
    if (!/^[\w.-]+(?:\/[\w.-]+)*(?:\/\*)?$/.test(glob)) {
      throw new Error(`unsupported workspace glob: ${glob}`);
    }
  }
  return globs;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** Manifest paths (relative, forward slashes) for the root and every workspace package. */
export function findManifests(root) {
  const dirs = new Set([""]);
  for (const glob of readWorkspaceGlobs(root)) {
    if (glob.endsWith("/*")) {
      const base = glob.slice(0, -2);
      if (!isDirectory(join(root, base))) continue;
      for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "node_modules") dirs.add(`${base}/${entry.name}`);
      }
    } else if (isDirectory(join(root, glob))) {
      dirs.add(glob);
    }
  }
  return [...dirs]
    .map((dir) => (dir === "" ? "package.json" : `${dir}/package.json`))
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

/** Allowlist entries: `{ path, script, reason }`. Malformed entries throw. */
export function readAllowlist(root) {
  const file = join(root, ALLOWLIST_PATH);
  if (!existsSync(file)) throw new Error(`${ALLOWLIST_PATH} is missing`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${ALLOWLIST_PATH} is not valid JSON`);
  }
  if (!data || !Array.isArray(data.allow)) throw new Error(`${ALLOWLIST_PATH} needs an "allow" array`);
  data.allow.forEach((entry, i) => {
    const ok =
      entry &&
      typeof entry.path === "string" &&
      FORBIDDEN_SCRIPTS.includes(entry.script) &&
      typeof entry.reason === "string" &&
      entry.reason.trim() !== "";
    if (!ok) throw new Error(`${ALLOWLIST_PATH} entry ${i} needs a path, a forbidden script name and a reason`);
  });
  return data.allow;
}

/**
 * Findings for a tree. Each is `{ path, script, kind }` where kind is
 * "forbidden" (script present, not allowlisted), "unreadable" (manifest is
 * not JSON), or "stale" (allowlist entry that matches nothing).
 */
export function scan(root = defaultRoot) {
  const allow = readAllowlist(root);
  const used = new Set();
  const findings = [];
  for (const path of findManifests(root)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch {
      findings.push({ path, script: "", kind: "unreadable" });
      continue;
    }
    const scripts = manifest && typeof manifest.scripts === "object" && manifest.scripts ? manifest.scripts : {};
    for (const script of FORBIDDEN_SCRIPTS) {
      if (!Object.hasOwn(scripts, script)) continue;
      const index = allow.findIndex((e) => e.path === path && e.script === script);
      if (index >= 0) used.add(index);
      else findings.push({ path, script, kind: "forbidden" });
    }
  }
  allow.forEach((entry, i) => {
    if (!used.has(i)) findings.push({ path: entry.path, script: entry.script, kind: "stale" });
  });
  return findings;
}

/** Commands that install dependencies, so run install-time scripts. */
const INSTALL_COMMAND = /(^|[\s;&|(])(?:pnpm\s+(?:install|i)|npm\s+(?:ci|install|i)|yarn\s+install)(?=\s|$|;|&|\|)/;
const LIFECYCLE_CHECK = "check-lifecycle-scripts.mjs";

/**
 * Jobs in one workflow that install dependencies before running this check.
 * Each is `{ file, line, job }`; an empty list means every installing job runs
 * the check first, so no job can run a lifecycle script the check would reject.
 *
 * Workflows are read as text: a job starts at a two-space key under `jobs:`,
 * and comment lines never count.
 */
export function findUnguardedInstalls(file, text) {
  const violations = [];
  let inJobs = false;
  let job = null;
  let guarded = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    if (/^jobs:\s*$/.test(raw)) {
      inJobs = true;
      return;
    }
    if (!inJobs) return;
    const start = /^  ([A-Za-z0-9_-]+):\s*$/.exec(raw);
    if (start) {
      job = start[1];
      guarded = false;
      return;
    }
    if (/^\S/.test(raw)) {
      inJobs = false;
      return;
    }
    const line = raw.trim();
    if (!job || line.startsWith("#") || /^(?:-\s+)?name:/.test(line)) return;
    if (line.includes(LIFECYCLE_CHECK)) guarded = true;
    if (INSTALL_COMMAND.test(line) && !guarded) violations.push({ file, line: index + 1, job });
  });
  return violations;
}

/** {@link findUnguardedInstalls} over every workflow in the repository. */
export function scanWorkflows(root = defaultRoot) {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .flatMap((name) => findUnguardedInstalls(`.github/workflows/${name}`, readFileSync(join(dir, name), "utf8")));
}

function main() {
  const logger = createLogger("scripts.check-lifecycle-scripts");
  const root = process.argv[2] ? resolve(process.argv[2]) : defaultRoot;
  let findings;
  let installs;
  try {
    findings = scan(root);
    installs = scanWorkflows(root);
  } catch (error) {
    logger.error("lifecycle-check-misconfigured", error.message);
    process.exitCode = 1;
    return;
  }
  if (findings.length === 0 && installs.length === 0) {
    logger.info(
      "lifecycle-check-passed",
      "No install-time lifecycle scripts in workspace manifests, and every installing job runs this check first",
    );
    return;
  }
  for (const f of findings) {
    const what =
      f.kind === "forbidden"
        ? `lifecycle script "${f.script}" is not allowlisted`
        : f.kind === "stale"
          ? `allowlist entry for "${f.script}" matches no script`
          : "manifest is not valid JSON";
    logger.error("lifecycle-script-found", `${f.path}: ${what}`);
  }
  for (const v of installs) {
    logger.error(
      "lifecycle-install-unguarded",
      `${v.file}:${v.line}: job "${v.job}" installs dependencies before running ${LIFECYCLE_CHECK}`,
    );
  }
  logger.error("lifecycle-check-failed", `See docs/CI.md ("Install-time lifecycle scripts") for the exception process`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
