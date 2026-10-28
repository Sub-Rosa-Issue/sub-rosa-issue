// Copyright (c) 2026 Sub Rosa contributors
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const LOCKFILE_PATH = new URL('../pnpm-lock.yaml', import.meta.url);
const ALLOWLIST_PATH = new URL('../config/lockfile-allowlist.json', import.meta.url);

/**
 * Load the allowlist of exceptional hosts.
 * Returns an array of hostname strings (e.g., ["github.com", "registry.example.com"]).
 */
function loadAllowlist(allowlistPath = ALLOWLIST_PATH) {
  try {
    const content = readFileSync(allowlistPath, 'utf8');
    const data = JSON.parse(content);
    if (!Array.isArray(data.allowlist)) {
      throw new Error('allowlist must be an array');
    }
    return data.allowlist.map(String).filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to load allowlist from ${allowlistPath}: ${err.message}`);
  }
}

/**
 * Extract the hostname from a URL, stripping credentials and paths.
 */
function extractHostname(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Sanitize a URL by removing credentials (user:pass@) for safe logging.
 */
function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    // Reconstruct URL without credentials
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url; // Return as-is if parsing fails
  }
}

/**
 * Check if a hostname is allowed by the allowlist.
 */
function isHostnameAllowed(hostname, allowlist) {
  if (!hostname) return false;
  return allowlist.some((allowed) => {
    // Exact match or subdomain match (e.g., "github.com" allows "raw.githubusercontent.com")
    return hostname === allowed || hostname.endsWith('.' + allowed);
  });
}

/**
 * Check a single package resolution for disallowed sources.
 * Returns an array of error strings (empty if OK).
 */
function checkPackageResolution(pkgName, resolution, allowlist) {
  const errors = [];

  if (!resolution || typeof resolution !== 'object') {
    return errors;
  }

  // Check for git source
  if (resolution.type === 'git') {
    const repo = resolution.repo || resolution.repository;
    const hostname = extractHostname(repo);
    if (!isHostnameAllowed(hostname, allowlist)) {
      errors.push(
        `${pkgName}: git source not allowed (host: ${hostname || 'unknown'}, repo: ${sanitizeUrl(repo)})`
      );
    }
  }

  // Check for file: source
  if (resolution.type === 'file') {
    errors.push(`${pkgName}: file: source not allowed`);
  }

  // Check for tarball URL - allow only HTTPS registry URLs
  if (resolution.tarball) {
    const tarballUrl = resolution.tarball;
    const hostname = extractHostname(tarballUrl);
    const isHttps = tarballUrl.startsWith('https://');

    if (!isHttps) {
      errors.push(`${pkgName}: non-HTTPS tarball not allowed (url: ${sanitizeUrl(tarballUrl)})`);
    } else if (!isHostnameAllowed(hostname, allowlist)) {
      // Allow common npm registries by default
      const defaultAllowed = [
        'registry.npmjs.org',
        'registry.yarnpkg.com',
        'registry.npmmirror.com',
      ];
      if (!defaultAllowed.includes(hostname) && !isHostnameAllowed(hostname, allowlist)) {
        errors.push(
          `${pkgName}: tarball from unrecognized registry host (host: ${hostname})`
        );
      }
    }
  }

  // Check for link: protocol in resolution (uncommon but possible)
  if (resolution.link) {
    errors.push(`${pkgName}: link: source not allowed in packages section`);
  }

  return errors;
}

/**
 * Check the importers section for link: dependencies that are not workspace packages.
 * Workspace packages (link:../../packages/...) are allowed.
 * External link: dependencies are not allowed.
 */
function checkImporters(importers, allowlist) {
  const errors = [];

  for (const [importerName, importerData] of Object.entries(importers || {})) {
    for (const depType of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const deps = importerData[depType];
      if (!deps) continue;

      for (const [depName, depInfo] of Object.entries(deps)) {
        const version = depInfo.version;
        if (typeof version === 'string' && version.startsWith('link:')) {
          const linkPath = version.slice(5); // Remove "link:"
          // Allow workspace links (relative paths starting with ../)
          // ./ links are local file dependencies, not workspace packages
          if (!linkPath.startsWith('../')) {
            errors.push(
              `${importerName} > ${depName}: external link: dependency not allowed (${version})`
            );
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Main check function.
 */
export function checkLockfileSources(lockfilePath = LOCKFILE_PATH, allowlistPath = ALLOWLIST_PATH) {
  const allowlist = loadAllowlist(allowlistPath);

  let lockfile;
  try {
    const content = readFileSync(lockfilePath, 'utf8');
    lockfile = parse(content);
  } catch (err) {
    throw new Error(`Failed to parse lockfile: ${err.message}`);
  }

  const allErrors = [];

  // Check packages section
  const packages = lockfile.packages;
  if (packages && typeof packages === 'object') {
    for (const [pkgName, pkgInfo] of Object.entries(packages)) {
      const resolution = pkgInfo.resolution;
      const errors = checkPackageResolution(pkgName, resolution, allowlist);
      allErrors.push(...errors);
    }
  }

  // Check importers section for external link: deps
  const importers = lockfile.importers;
  if (importers && typeof importers === 'object') {
    const errors = checkImporters(importers, allowlist);
    allErrors.push(...errors);
  }

  return allErrors;
}

/**
 * Format errors for human-readable output.
 */
export function formatErrors(errors) {
  if (errors.length === 0) {
    return '✅ All lockfile sources are allowed.';
  }

  const lines = ['❌ Lockfile source policy violations found:', ''];
  for (const error of errors) {
    lines.push(`  • ${error}`);
  }
  lines.push('');
  lines.push('To allow an exceptional host, add it to config/lockfile-allowlist.json');
  lines.push('Example: { "allowlist": ["github.com", "registry.example.com"] }');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Allow optional command-line overrides: node check-lockfile-sources.mjs [lockfile] [allowlist]
    const lockfileArg = process.argv[2];
    const allowlistArg = process.argv[3];
    const lockfilePath = lockfileArg ? new URL(lockfileArg, import.meta.url) : LOCKFILE_PATH;
    const allowlistPath = allowlistArg ? new URL(allowlistArg, import.meta.url) : ALLOWLIST_PATH;
    const errors = checkLockfileSources(lockfilePath, allowlistPath);
    console.log(formatErrors(errors));
    if (errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}