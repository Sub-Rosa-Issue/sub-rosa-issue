#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";
import { normalizeError } from "../packages/logging/src/errors.cjs";

const diagnostics = createLogger("scripts.run-drand-tools-ci");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export const CI_STEPS = Object.freeze(["drand-tools:test", "drand-tools:typecheck"]);
export const TARGET_WORKSPACES = Object.freeze([{"path": "services/drand-tools", "name": "@sub-rosa/drand-tools"}]);

export function verifyDrandToolsCiConfig(root = ROOT) {
  const rootPkgPath = resolve(root, "package.json");
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
  const scripts = rootPkg.scripts ?? {};

  for (const step of CI_STEPS) {
    if (!scripts[step]) {
      throw new Error(`Missing required root script: ${step}`);
    }
  }

  for (const ws of TARGET_WORKSPACES) {
    const wsPkgPath = resolve(root, ws.path, "package.json");
    if (!existsSync(wsPkgPath)) {
      throw new Error(`Missing workspace package.json: ${ws.path}`);
    }
    const wsPkg = JSON.parse(readFileSync(wsPkgPath, "utf8"));
    if (wsPkg.name !== ws.name) {
      throw new Error(`Unexpected package name in ${ws.path}: ${wsPkg.name}`);
    }
    if (!wsPkg.scripts?.test) {
      throw new Error(`Missing test script in ${ws.path}`);
    }
    if (!wsPkg.scripts?.typecheck) {
      throw new Error(`Missing typecheck script in ${ws.path}`);
    }
  }

  return { steps: CI_STEPS, workspaces: TARGET_WORKSPACES };
}

export function runDrandToolsCi(root = ROOT, runner = execFileSync) {
  verifyDrandToolsCiConfig(root);
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  for (const step of CI_STEPS) {
    diagnostics.info("ci-step-start", `Running pnpm ${step}`);
    try {
      runner(pnpmBin, ["run", step], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env },
      });
    } catch (error) {
      diagnostics.error("ci-step-failed", normalizeError(error));
      throw new Error(`Blocking CI step failed: ${step}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDrandToolsCi();
}
