#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

/**
 * Extract the leading major version number from a version string or semver range.
 * Examples: "22" -> "22", "v22.14.0" -> "22", ">=22" -> "22", ">=22.0.0 <23" -> "22".
 */
export function parseNodeMajor(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:>=|~|\^|v)?\s*(\d+)(?:\.\d+(?:\.\d+)?)?$/);
  return match ? match[1] : null;
}

/**
 * Validate that `.nvmrc` (and `.node-version` if present), `package.json#engines.node`,
 * and every `actions/setup-node` step under `.github/workflows/*.yml` declare the
 * same Node.js major version.
 */
export function verifyNodeVersionConsistency(rootDir = DEFAULT_ROOT) {
  const issues = [];
  const nvmrcPath = join(rootDir, ".nvmrc");
  const nodeVersionPath = join(rootDir, ".node-version");

  let declaredMajor = null;
  let declaredSource = null;

  if (existsSync(nvmrcPath)) {
    const raw = readFileSync(nvmrcPath, "utf8").trim();
    declaredMajor = parseNodeMajor(raw);
    declaredSource = ".nvmrc";
    if (!declaredMajor) {
      issues.push(`.nvmrc contains an invalid Node version: ${JSON.stringify(raw)}`);
    }
  }

  if (existsSync(nodeVersionPath)) {
    const raw = readFileSync(nodeVersionPath, "utf8").trim();
    const major = parseNodeMajor(raw);
    if (!major) {
      issues.push(`.node-version contains an invalid Node version: ${JSON.stringify(raw)}`);
    } else if (declaredMajor && major !== declaredMajor) {
      issues.push(
        `.node-version (${major}) does not match ${declaredSource} (${declaredMajor})`,
      );
    } else if (!declaredMajor) {
      declaredMajor = major;
      declaredSource = ".node-version";
    }
  }

  if (!existsSync(nvmrcPath) && !existsSync(nodeVersionPath)) {
    issues.push("Missing Node version file (.nvmrc or .node-version) at repository root");
    return { ok: false, expectedMajor: null, issues };
  }

  if (!declaredMajor) {
    return { ok: false, expectedMajor: null, issues };
  }

  const pkgPath = join(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    issues.push("Missing root package.json");
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const engineNode = pkg.engines?.node;
    const engineMajor = parseNodeMajor(engineNode ?? "");
    if (!engineNode) {
      issues.push("package.json is missing engines.node");
    } else if (engineMajor !== declaredMajor) {
      issues.push(
        `package.json engines.node (${JSON.stringify(engineNode)}) does not match ${declaredSource} (${declaredMajor})`,
      );
    }
  }

  const workflowsDir = join(rootDir, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    const files = readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort();

    for (const file of files) {
      const relPath = `.github/workflows/${file}`;
      const content = readFileSync(join(workflowsDir, file), "utf8");
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^\s*node-version\s*:\s*['"]?([^'"#\s]+)['"]?/);
        if (match) {
          const wfVersion = match[1];
          const wfMajor = parseNodeMajor(wfVersion);
          if (wfMajor !== declaredMajor) {
            issues.push(
              `${relPath}:${i + 1} node-version (${JSON.stringify(wfVersion)}) does not match ${declaredSource} (${declaredMajor})`,
            );
          }
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    expectedMajor: declaredMajor,
    issues,
  };
}

function main() {
  const args = process.argv.slice(2);
  let rootDir = DEFAULT_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && i + 1 < args.length) {
      rootDir = resolve(args[i + 1]);
      i++;
    }
  }

  const result = verifyNodeVersionConsistency(rootDir);
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`❌ ${issue}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `✅ Node version ${result.expectedMajor} is consistent across version files, package.json, and workflows.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
