#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.dependabot-security");
/**
 * Check (and optionally enable) the repository-level Dependabot security
 * settings described in docs/DEPENDABOT_SECURITY.md:
 *
 *   1. Dependency graph            (always on for public repositories)
 *   2. Dependabot alerts           PUT /repos/{repo}/vulnerability-alerts
 *   3. Dependabot security updates PUT /repos/{repo}/automated-security-fixes
 *
 * These are repository settings, not files, so they cannot ship in a PR. The
 * script lets a maintainer with admin access apply them and lets anyone with
 * admin access verify them later.
 *
 * Usage:
 *   node scripts/dependabot-security.mjs [--repo owner/name]          # check
 *   node scripts/dependabot-security.mjs [--repo owner/name] --apply  # enable
 *
 * Exit codes: 0 all settings enabled, 1 something is disabled or unknown,
 * 2 bad usage. Scheduled version updates live in .github/dependabot.yml (#482)
 * and are intentionally out of scope here.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_REPO = "Sub-Rosa-Issue/sub-rosa-issue";

/**
 * Llama a `gh api` y devuelve `{ ok, status, body }` sin tirar.
 * gh sale con codigo distinto de cero ante cualquier 4xx, asi que el status
 * se saca del texto de error ("HTTP 404").
 */
export function ghApi(method, path) {
  try {
    const body = execFileSync("gh", ["api", "--method", method, "-H", "Accept: application/vnd.github+json", path], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, status: body.trim() ? 200 : 204, body };
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const match = stderr.match(/HTTP (\d{3})/);
    return { ok: false, status: match ? Number(match[1]) : null, body: stderr.trim() };
  }
}

/** Lee el estado actual de las tres configuraciones. */
export function readState(repo, api = ghApi) {
  const meta = api("GET", `repos/${repo}`);
  let visibility = null;
  if (meta.ok) {
    try {
      visibility = JSON.parse(meta.body).visibility ?? null;
    } catch {
      visibility = null;
    }
  }

  // 204 = activado, 404 = desactivado (o sin permiso de admin: GitHub no distingue).
  const alerts = api("GET", `repos/${repo}/vulnerability-alerts`);
  const alertsEnabled = alerts.ok ? true : alerts.status === 404 ? false : null;

  // 200 con { enabled, paused }; 404 cuando las alertas estan apagadas.
  const fixes = api("GET", `repos/${repo}/automated-security-fixes`);
  let securityUpdatesEnabled = null;
  let securityUpdatesPaused = false;
  if (fixes.ok) {
    try {
      const parsed = JSON.parse(fixes.body);
      securityUpdatesEnabled = parsed.enabled === true;
      securityUpdatesPaused = parsed.paused === true;
    } catch {
      securityUpdatesEnabled = null;
    }
  } else if (fixes.status === 404) {
    securityUpdatesEnabled = false;
  }

  return {
    visibility,
    // El grafo de dependencias no se puede apagar en repos publicos.
    dependencyGraph: visibility === "public" ? true : null,
    alerts: alertsEnabled,
    securityUpdates: securityUpdatesEnabled,
    securityUpdatesPaused,
  };
}

/** Convierte un estado en filas legibles y un veredicto. */
export function evaluate(state) {
  const label = (value) => (value === true ? "enabled" : value === false ? "disabled" : "unknown");
  const rows = [
    {
      id: "dependency-graph",
      name: "Dependency graph",
      status: label(state.dependencyGraph),
      note:
        state.dependencyGraph === null
          ? "Not a public repo (or metadata unreadable): enable it under Settings → Code security."
          : "Always on for public repositories.",
    },
    {
      id: "dependabot-alerts",
      name: "Dependabot alerts",
      status: label(state.alerts),
      note: state.alerts === true ? "" : "Requires admin access to read or change.",
    },
    {
      id: "dependabot-security-updates",
      name: "Dependabot security updates",
      status: state.securityUpdatesPaused ? "paused" : label(state.securityUpdates),
      note: state.securityUpdatesPaused ? "GitHub paused security updates; re-enable in Settings → Code security." : "",
    },
  ];
  const ok = rows.every((row) => row.status === "enabled");
  return { ok, rows };
}

/** Activa alertas y luego actualizaciones de seguridad (el orden importa). */
export function apply(repo, api = ghApi) {
  const steps = [
    ["dependabot-alerts", `repos/${repo}/vulnerability-alerts`],
    ["dependabot-security-updates", `repos/${repo}/automated-security-fixes`],
  ];
  const results = [];
  for (const [id, path] of steps) {
    const res = api("PUT", path);
    results.push({ id, ok: res.ok, status: res.status, error: res.ok ? null : res.body });
    // Sin alertas GitHub rechaza las actualizaciones de seguridad: no seguir.
    if (!res.ok) break;
  }
  return results;
}

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--repo") {
      const value = argv[++i];
      if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error(`--repo expects owner/name, got: ${value ?? "(nothing)"}`);
      opts.repo = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), api = ghApi) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    diagnostics.error("usage", error.message);
    return 2;
  }

  if (opts.apply) {
    for (const step of apply(opts.repo, api)) {
      if (step.ok) diagnostics.info("applied", `Enabled ${step.id} on ${opts.repo}`);
      else diagnostics.error("apply-failed", `Could not enable ${step.id} on ${opts.repo} (HTTP ${step.status ?? "?"})`, { error: step.error });
    }
  }

  const { ok, rows } = evaluate(readState(opts.repo, api));
  for (const row of rows) {
    diagnostics.info("setting", `[${row.status.toUpperCase()}] ${row.name}${row.note ? ` — ${row.note}` : ""}`, { id: row.id });
  }
  if (ok) diagnostics.info("passed", `All Dependabot security settings are enabled on ${opts.repo}`);
  else diagnostics.error("failed", `Dependabot security settings are incomplete on ${opts.repo}; see docs/DEPENDABOT_SECURITY.md`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
