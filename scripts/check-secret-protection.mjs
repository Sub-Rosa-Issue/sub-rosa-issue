#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, writeData } from '../packages/logging/src/index.cjs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const diagnostics = createLogger('scripts.check-secret-protection');

// scripts/check-secret-protection.mjs
//
// Comprueba (y, con --enable, activa) las protecciones de secretos de GitHub
// para un repositorio:
//
//   - secret_scanning                      escaneo de secretos
//   - secret_scanning_push_protection      push protection
//   - secret_scanning_non_provider_patterns  deteccion de patrones no-proveedor
//   - secret_scanning_validity_checks      comprobaciones de validez
//
// El estado vive en la configuracion del repositorio (Settings > Code
// security), no en el arbol de ficheros, asi que este script es la forma
// reproducible de confirmarlo y de activarlo.
//
// Solo imprime estados. Nunca imprime el token ni ningun valor de secreto.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FEATURES = [
  { key: 'secret_scanning', label: 'Secret scanning', required: true },
  { key: 'secret_scanning_push_protection', label: 'Push protection', required: true },
  {
    key: 'secret_scanning_non_provider_patterns',
    label: 'Non-provider pattern detection',
    required: false,
  },
  { key: 'secret_scanning_validity_checks', label: 'Validity checks', required: false },
];

const DEFAULT_API_BASE = 'https://api.github.com';

function defaultRepo() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
    const url = String(pkg.repository?.url ?? '');
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch {
    // Sin package.json legible se cae al repositorio por defecto de abajo.
  }
  return { owner: 'Sub-Rosa-Issue', repo: 'sub-rosa-issue' };
}

function parseRepo(value) {
  const match = String(value).match(/^([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function parseArgs(argv) {
  const options = {
    repo: parseRepo(process.env.SECRET_PROTECTION_REPO ?? '') ?? defaultRepo(),
    token: process.env.SECRET_PROTECTION_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    apiBase: process.env.SECRET_PROTECTION_API_BASE ?? DEFAULT_API_BASE,
    enable: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        diagnostics.error('usage', `Missing value for ${arg}`);
        process.exit(2);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--repo': {
        const value = next();
        const repo = parseRepo(value);
        if (!repo) {
          diagnostics.error('usage', `--repo expects owner/name, got "${value}"`);
          process.exit(2);
        }
        options.repo = repo;
        break;
      }
      case '--token':
        options.token = next();
        break;
      case '--api-base':
        options.apiBase = next();
        break;
      case '--enable':
        options.enable = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        diagnostics.error('usage', `Unknown argument: ${arg}`);
        process.exit(2);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node scripts/check-secret-protection.mjs [options]',
    '',
    'Options:',
    '  --repo <owner/name>  Repository to inspect (default: from package.json)',
    '  --token <token>      Token with Administration read (and write with --enable)',
    '  --api-base <url>     GitHub API base URL (default: https://api.github.com)',
    '  --enable             Enable the settings instead of only reporting them',
    '  --json               Print a machine-readable summary',
    '',
    'Environment: SECRET_PROTECTION_TOKEN, GITHUB_TOKEN, GH_TOKEN,',
    '              SECRET_PROTECTION_REPO, SECRET_PROTECTION_API_BASE',
  ].join('\n');
}

async function apiRequest({ apiBase, token, method, path, body }) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Cuerpo no-JSON (por ejemplo, un error de proxy). Se conserva el texto.
  }

  return { status: response.status, ok: response.ok, json, text };
}

function describeApiError(response) {
  const message = response.json?.message ?? response.text?.slice(0, 200) ?? 'sin detalle';
  if (response.status === 403) {
    return `403 ${message}. The token needs "Administration: read" (check) or "Administration: write" (--enable) on the repository.`;
  }
  if (response.status === 404) {
    return `404 ${message}. The repository does not exist or the token cannot see it.`;
  }
  if (response.status === 422) {
    return `422 ${message}.`;
  }
  return `${response.status} ${message}`;
}

// Evalua el estado de cada proteccion a partir del bloque
// security_and_analysis que devuelve la API.
//
//   enabled     -> activo
//   disabled    -> existe pero esta apagado (fallo)
//   unavailable -> la API no expone la proteccion (no disponible en este plan)
//   unknown     -> la proteccion es obligatoria pero la API no informo de ella
function evaluateFeatures(securityAndAnalysis) {
  return FEATURES.map((feature) => {
    const entry = securityAndAnalysis?.[feature.key];
    const status = typeof entry?.status === 'string' ? entry.status : null;

    if (status === 'enabled') {
      return { ...feature, status, state: 'enabled' };
    }
    if (status === 'disabled') {
      return { ...feature, status, state: 'disabled' };
    }
    if (!feature.required) {
      return { ...feature, status, state: 'unavailable' };
    }
    return { ...feature, status, state: 'unknown' };
  });
}

function isProtected(features) {
  return features.every(
    (feature) => feature.state === 'enabled' || (!feature.required && feature.state === 'unavailable'),
  );
}

function reportFeatures(features, { owner, repo }) {
  diagnostics.info('repository', `Repository: ${owner}/${repo}`);
  for (const feature of features) {
    const tag =
      feature.state === 'enabled'
        ? 'PASS'
        : feature.state === 'unavailable'
          ? 'N/A '
          : 'FAIL';
    const detail =
      feature.state === 'enabled'
        ? 'enabled'
        : feature.state === 'unavailable'
          ? 'not available for this repository/plan'
          : feature.state === 'disabled'
            ? 'disabled'
            : 'not reported by the API (insufficient permissions?)';
    diagnostics.info('feature', `  [${tag}] ${feature.label} (${feature.key}) — ${detail}`);
  }
}

async function enableFeature({ apiBase, token, owner, repo, feature }) {
  const response = await apiRequest({
    apiBase,
    token,
    method: 'PATCH',
    path: `/repos/${owner}/${repo}`,
    body: { security_and_analysis: { [feature.key]: { status: 'enabled' } } },
  });

  if (response.ok) {
    return { feature, outcome: 'enabled' };
  }
  if (response.status === 422) {
    // La API rechaza la proteccion cuando no esta disponible para este
    // repositorio o plan (por ejemplo, patrones no-proveedor sin GitHub
    // Advanced Security). No es un fallo del repositorio.
    return { feature, outcome: 'unavailable', detail: describeApiError(response) };
  }
  return { feature, outcome: 'error', detail: describeApiError(response) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    writeData(usage());
    return 0;
  }

  if (!options.token) {
    diagnostics.error('usage', 'No token found. Pass --token or set SECRET_PROTECTION_TOKEN / GITHUB_TOKEN / GH_TOKEN.');
    return 2;
  }

  const { owner, repo } = options.repo;

  if (options.enable) {
    diagnostics.info('enable', `Enabling secret protection on ${owner}/${repo}`);
    for (const feature of FEATURES) {
      const result = await enableFeature({ ...options, owner, repo, feature });
      if (result.outcome === 'enabled') {
        diagnostics.info('enable-ok', `  [OK] ${feature.label} (${feature.key}) — enabled`);
      } else if (result.outcome === 'unavailable') {
        diagnostics.info('enable-na', `  [N/A] ${feature.label} (${feature.key}) — not available for this repository/plan`);
      } else {
        diagnostics.error('enable-fail', `  [FAIL] ${feature.label} (${feature.key}) — ${result.detail}`);
      }
    }
  }

  const response = await apiRequest({
    apiBase: options.apiBase,
    token: options.token,
    method: 'GET',
    path: `/repos/${owner}/${repo}`,
  });

  if (!response.ok) {
    diagnostics.error('api', `Could not read repository settings: ${describeApiError(response)}`);
    return 1;
  }

  const securityAndAnalysis = response.json?.security_and_analysis;
  if (!securityAndAnalysis || typeof securityAndAnalysis !== 'object') {
    diagnostics.error(
      'api',
      'The API response does not include security_and_analysis. The token cannot read repository settings, ' +
        'or this repository does not expose secret-protection settings. A token with Administration read is required.',
    );
    return 1;
  }

  const features = evaluateFeatures(securityAndAnalysis);
  reportFeatures(features, { owner, repo });

  const ok = isProtected(features);
  const unavailable = features.filter((feature) => feature.state === 'unavailable').map((feature) => feature.key);

  if (options.json) {
    writeData(
      JSON.stringify({
        repository: `${owner}/${repo}`,
        ok,
        features: features.map((feature) => ({
          key: feature.key,
          label: feature.label,
          required: feature.required,
          status: feature.status,
          state: feature.state,
        })),
      }),
    );
  }

  if (ok) {
    diagnostics.info(
      'ok',
      `PASS: secret protection is enabled for ${owner}/${repo}` +
        (unavailable.length > 0 ? ` (not available here: ${unavailable.join(', ')})` : ''),
    );
    return 0;
  }

  const failing = features
    .filter((feature) => feature.state === 'disabled' || feature.state === 'unknown')
    .map((feature) => feature.key);
  diagnostics.error('fail', `FAIL: secret protection is incomplete for ${owner}/${repo} — ${failing.join(', ')}`);
  return 1;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      diagnostics.error('unexpected', `Unexpected failure: ${error?.message ?? String(error)}`);
      process.exitCode = 1;
    });
}

export { evaluateFeatures, isProtected, parseArgs, FEATURES };
