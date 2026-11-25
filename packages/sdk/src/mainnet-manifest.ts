// SPDX-License-Identifier: MIT
// Reads the committed artifact manifest and the recorded fixture from disk.
// Deliberately NOT re-exported from the package barrel: `node:fs` must stay out
// of browser bundles, so callers that already have a parsed manifest (or run in
// a browser) depend on `mainnet-artifacts.js` alone.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeError } from "@sub-rosa/logging/errors";

import { SubRosaManifestError } from "./errors.js";
import {
  MAINNET_MANIFEST_PATH,
  parseMainnetManifest,
  type MainnetManifest,
} from "./mainnet-artifacts.js";
import {
  parseMainnetReadinessFixture,
  type MainnetReadinessFixture,
} from "./mainnet-readiness.js";

/** Repo-relative path of the committed manifest. */
export const MAINNET_MANIFEST_PATH_REPO = MAINNET_MANIFEST_PATH;

/** Repo-relative path of the committed fixture that replays a green check. */
export const MAINNET_FIXTURE_PATH = "packages/sdk/fixtures/mainnet-readiness.json";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

export interface LoadedMainnetManifest {
  manifest: MainnetManifest;
  /** Absolute path the manifest was read from, for report/log context. */
  path: string;
  /** sha256 of the manifest bytes, so a report can pin what it compared. */
  sha256: string;
}

/**
 * Where a repo-relative artifact may live. The commands run from the repo root
 * (`pnpm mainnet:ready`) and from the package (`pnpm --filter … exec`), so try
 * both before giving up and naming the cwd-relative path in the error.
 */
function candidatePaths(
  relative: string | undefined,
  fallbackRelative: string,
  cwd: string,
): string[] {
  const rel = relative ?? fallbackRelative;
  if (isAbsolute(rel)) return [rel];
  const inPackage = rel.replace(/^packages\/sdk\//, "");
  const candidates = [
    resolve(cwd, rel),
    resolve(REPO_ROOT, rel),
    resolve(PACKAGE_ROOT, inPackage),
  ];
  if (relative === undefined) candidates.push(resolve(REPO_ROOT, inPackage));
  return [...new Set(candidates)];
}

function firstExisting(candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/** Absolute path of the committed manifest. */
export function resolveMainnetManifestPath(
  path?: string,
  cwd: string = process.cwd(),
): string {
  return firstExisting(candidatePaths(path, MAINNET_MANIFEST_PATH, cwd));
}

function readJson(path: string, label: string): { raw: unknown; text: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new SubRosaManifestError(
      `cannot read the ${label} at ${path}`,
      { cause, path },
    );
  }
  try {
    return { raw: JSON.parse(text), text };
  } catch (cause) {
    throw new SubRosaManifestError(
      `the ${label} at ${path} is not valid JSON`,
      { cause, path },
    );
  }
}

function fieldOf(cause: unknown): string | undefined {
  return cause instanceof Error && "field" in cause
    ? String((cause as { field: unknown }).field)
    : undefined;
}

/**
 * Load the manifest the repo commits. Throws `SubRosaManifestError` (never
 * silently falls back to defaults) so a missing or edited manifest cannot turn
 * a readiness run into a green check against unreviewed expectations.
 */
export function loadMainnetManifest(
  path?: string,
  cwd: string = process.cwd(),
): LoadedMainnetManifest {
  const resolved = resolveMainnetManifestPath(path, cwd);
  const { raw, text } = readJson(resolved, "committed mainnet manifest");
  let manifest: MainnetManifest;
  try {
    manifest = parseMainnetManifest(raw);
  } catch (cause) {
    throw new SubRosaManifestError(
      `the committed mainnet manifest at ${resolved} is invalid: ${normalizeError(cause).message}`,
      { cause, field: fieldOf(cause), path: resolved },
    );
  }
  return {
    manifest,
    path: resolved,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

/**
 * Load a recorded mainnet snapshot for CI. Same closed-schema validation as the
 * manifest: no RPC endpoint, no account, and no secret key is involved.
 */
export function loadMainnetReadinessFixture(
  path?: string,
  cwd: string = process.cwd(),
): { fixture: MainnetReadinessFixture; path: string } {
  const resolved = firstExisting(
    candidatePaths(path, MAINNET_FIXTURE_PATH, cwd),
  );
  const { raw } = readJson(resolved, "mainnet readiness fixture");
  let fixture: MainnetReadinessFixture;
  try {
    fixture = parseMainnetReadinessFixture(raw);
  } catch (cause) {
    throw new SubRosaManifestError(
      `the mainnet readiness fixture at ${resolved} is invalid: ${normalizeError(cause).message}`,
      { cause, field: fieldOf(cause), path: resolved },
    );
  }
  return { fixture, path: resolved };
}
