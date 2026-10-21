#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
// Static pnpm-lock.yaml source-policy checker

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../packages/logging/src/index.cjs';

const diagnostics = createLogger("scripts.check-lockfile-sources");

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LOCKFILE_PATH = resolve(PROJECT_ROOT, 'pnpm-lock.yaml');

// Allowlist for exceptional hosts (initially empty, documented)
// Add hosts here with explicit justification
const ALLOWLIST_HOSTS = new Set([
  // Example: 'github.com', 'raw.githubusercontent.com'
]);

// Protocols that are always rejected
const REJECTED_PROTOCOLS = new Set([
  'git:',
  'git+ssh:',
  'git+http:',
  'git+https:',
  'github:',      // pnpm GitHub shorthand (github:owner/repo)
  'gitlab:',      // pnpm GitLab shorthand
  'bitbucket:',   // pnpm Bitbucket shorthand
  'ssh:',
  'file:',
  'http:',
]);

// Allowed protocols (HTTPS + pnpm workspace protocol)
const ALLOWED_PROTOCOLS = new Set([
  'https:',
  'workspace:',
]);

// Special handling: link: is allowed only for workspace dependency resolutions
// (pnpm resolves workspace:* to link: in the version field)

// Registry hostnames that are allowed (npm registry and common mirrors)
const ALLOWED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'registry.npmmirror.com',
  'codeload.github.com', // GitHub tarballs (used by pnpm for git deps)
]);

/**
 * Parse a URL and extract protocol, hostname, and path
 * Returns null if the string doesn't look like a URL
 */
function parseSourceUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      pathname: url.pathname,
      href: url.href,
      // Sanitized version without credentials or full signed URLs
      sanitized: `${url.protocol}//${url.hostname}${url.pathname}`,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a source string represents a rejected source type
 * @returns {Array} Array of violation objects
 */
function checkSource(source, context) {
  const violations = [];

  // Check for link: protocol
  // Allow link: in version field for workspace dependencies (pnpm resolves workspace:* to link:)
  const isWorkspaceResolution = context.endsWith(':version');
  if (source.startsWith('link:')) {
    if (!isWorkspaceResolution) {
      violations.push({
        type: 'link-protocol',
        message: 'link: protocol not allowed (workspace deps should use workspace:*)',
        source,
        context,
      });
    }
    return violations;
  }

  // Check for file: protocol
  if (source.startsWith('file:')) {
    violations.push({
      type: 'file-protocol',
      message: 'file: protocol not allowed',
      source,
      context,
    });
    return violations;
  }

  // Parse as URL
  const parsed = parseSourceUrl(source);
  if (!parsed) {
    // Not a URL, could be a version number or other specifier
    return violations;
  }

  const { protocol, hostname, sanitized } = parsed;

  // Check for explicitly rejected protocols
  if (REJECTED_PROTOCOLS.has(protocol)) {
    violations.push({
      type: 'rejected-protocol',
      message: `Rejected protocol: ${protocol}`,
      source: sanitized,
      context,
    });
    return violations;
  }

  // Check if protocol is allowed
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    violations.push({
      type: 'disallowed-protocol',
      message: `Protocol not in allowlist: ${protocol}`,
      source: sanitized,
      context,
    });
    return violations;
  }

  // For HTTPS, check if host is allowed
  if (protocol === 'https:') {
    const isAllowedHost = ALLOWED_REGISTRY_HOSTS.has(hostname) || ALLOWLIST_HOSTS.has(hostname);

    if (!isAllowedHost) {
      violations.push({
        type: 'disallowed-host',
        message: `Host not in allowlist: ${hostname}`,
        source: sanitized,
        context,
      });
    }
  }

  return violations;
}

/**
 * Simple YAML parser for pnpm-lock.yaml structure
 * Extracts sources from importers and packages sections
 */
function parseLockfile(content) {
  const lines = content.split('\n');
  const sources = [];
  let currentSection = null; // 'importers' or 'packages'
  let inImporter = false;
  let currentImporter = null;
  let currentDepType = null; // 'dependencies', 'devDependencies', 'optionalDependencies'
  let indentStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Calculate indent level (2 spaces per level in pnpm lockfile)
    const indent = line.search(/\S/);
    const level = Math.floor(indent / 2);

    // Trim indent stack to current level
    while (indentStack.length > level) {
      indentStack.pop();
    }

    // Detect section headers
    if (trimmed === 'importers:') {
      currentSection = 'importers';
      indentStack.push({ level, key: 'importers' });
      continue;
    }
    if (trimmed === 'packages:') {
      currentSection = 'packages';
      indentStack.push({ level, key: 'packages' });
      continue;
    }

    // In importers section
    if (currentSection === 'importers') {
      // Detect importer name (e.g., "  .:" or "  apps/web:")
      if (level === 1 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
        currentImporter = trimmed.slice(0, -1);
        inImporter = true;
        currentDepType = null;
        indentStack.push({ level, key: currentImporter });
        continue;
      }

      // Detect dependency type
      if (inImporter && level === 2) {
        if (trimmed === 'dependencies:' || trimmed === 'devDependencies:' || trimmed === 'optionalDependencies:') {
          currentDepType = trimmed.slice(0, -1);
          indentStack.push({ level, key: currentDepType });
          continue;
        }
      }

      // Detect package specifier and version
      if (inImporter && currentDepType && level === 3 && trimmed.endsWith(':')) {
        const pkgName = trimmed.slice(0, -1);
        indentStack.push({ level, key: pkgName });
        continue;
      }

      // Detect specifier field (what user wrote in package.json)
      if (inImporter && currentDepType && level === 4 && trimmed.startsWith('specifier:')) {
        const specifier = trimmed.slice('specifier:'.length).trim();
        // Remove quotes if present
        const cleanSpecifier = specifier.replace(/^["']|["']$/g, '');
        if (cleanSpecifier) {
          sources.push({
            package: indentStack[indentStack.length - 1].key,
            source: cleanSpecifier,
            context: `importer:${currentImporter}:${currentDepType}:specifier`,
          });
        }
        continue;
      }

      // Detect version field (pnpm's resolved version) - also check for non-workspace link: deps
      if (inImporter && currentDepType && level === 4 && trimmed.startsWith('version:')) {
        const version = trimmed.slice('version:'.length).trim();
        // Remove quotes if present
        const cleanVersion = version.replace(/^["']|["']$/g, '');
        if (cleanVersion) {
          sources.push({
            package: indentStack[indentStack.length - 1].key,
            source: cleanVersion,
            context: `importer:${currentImporter}:${currentDepType}:version`,
          });
        }
        continue;
      }
    }

    // In packages section
    if (currentSection === 'packages') {
      // Package key with URL (e.g., "  lodash@https://...:")
      if (level === 1 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
        const pkgKey = trimmed.slice(0, -1);
        // Check if key contains a URL source
        const atIndex = pkgKey.lastIndexOf('@');
        if (atIndex > 0) {
          const source = pkgKey.slice(atIndex + 1);
          const name = pkgKey.slice(0, atIndex);
          // Only add if it looks like a URL
          if (source.includes('://') || source.startsWith('git:') || source.startsWith('file:') || source.startsWith('link:')) {
            sources.push({
              package: name,
              source,
              context: 'packages:key',
            });
          }
        }
        indentStack.push({ level, key: pkgKey });
        continue;
      }

      // Resolution field in packages
      if (level === 2 && trimmed.startsWith('resolution:')) {
        // resolution can be a string or an object
        const rest = trimmed.slice('resolution:'.length).trim();
        if (rest && !rest.startsWith('{')) {
          // String resolution
          const cleanResolution = rest.replace(/^["']|["']$/g, '');
          if (cleanResolution) {
            sources.push({
              package: indentStack[indentStack.length - 1]?.key || 'unknown',
              source: cleanResolution,
              context: 'packages:resolution:string',
            });
          }
        } else if (rest.startsWith('{')) {
          // Inline object resolution - check for tarball field
          const tarballMatch = rest.match(/tarball:\s*["']?([^"',}\s]+)["']?/);
          if (tarballMatch) {
            const tarball = tarballMatch[1];
            sources.push({
              package: indentStack[indentStack.length - 1]?.key || 'unknown',
              source: tarball,
              context: 'packages:resolution:tarball',
            });
          }
          const gitHostedMatch = rest.match(/gitHosted:\s*(true|false)/);
          if (gitHostedMatch && gitHostedMatch[1] === 'true') {
            sources.push({
              package: indentStack[indentStack.length - 1]?.key || 'unknown',
              source: 'git-hosted:true',
              context: 'packages:resolution:gitHosted',
            });
          }
        }
        // Multi-line object resolution will be handled on subsequent lines
        continue;
      }

      // Resolution fields (integrity, tarball, gitHosted)
      if (level === 3 && indentStack[indentStack.length - 1]?.key === 'resolution') {
        if (trimmed.startsWith('tarball:')) {
          const tarball = trimmed.slice('tarball:'.length).trim().replace(/^["']|["']$/g, '');
          if (tarball) {
            sources.push({
              package: indentStack[indentStack.length - 2]?.key || 'unknown',
              source: tarball,
              context: 'packages:resolution:tarball',
            });
          }
        } else if (trimmed.startsWith('gitHosted:')) {
          const gitHosted = trimmed.slice('gitHosted:'.length).trim();
          if (gitHosted === 'true') {
            sources.push({
              package: indentStack[indentStack.length - 2]?.key || 'unknown',
              source: 'git-hosted:true',
              context: 'packages:resolution:gitHosted',
            });
          }
        }
      }
    }
  }

  return sources;
}

/**
 * Main check function
 */
export function checkLockfileSources(lockfilePath = LOCKFILE_PATH) {
  const content = readFileSync(lockfilePath, 'utf8');
  const sources = parseLockfile(content);

  const allViolations = [];
  const checkedSources = [];

  for (const { package: pkg, source, context } of sources) {
    checkedSources.push({ package: pkg, source, context });
    const violations = checkSource(source, context);
    if (violations.length > 0) {
      allViolations.push(...violations.map(v => ({ ...v, package: pkg })));
    }
  }

  return {
    checked: checkedSources.length,
    violations: allViolations,
    sources: checkedSources,
  };
}

/**
 * Sanitize a package identifier to remove credentials
 */
function sanitizePackageIdentifier(identifier) {
  // Remove credentials from git URLs in package keys (e.g., "pkg@git+ssh://git@host/..." -> "pkg@git+ssh://host/...")
  return identifier.replace(/(@[a-z+]+:\/\/)[^:@]+@/g, '$1');
}

/**
 * Format violations for output
 */
function formatViolations(violations) {
  return violations.map(v =>
    `  ${sanitizePackageIdentifier(v.package)} (${v.context}): ${v.message} — ${v.source}`
  ).join('\n');
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const lockfilePath = process.argv[2] ? resolve(PROJECT_ROOT, process.argv[2]) : LOCKFILE_PATH;
    const result = checkLockfileSources(lockfilePath);

    if (result.violations.length > 0) {
      diagnostics.error("fail", `\nFAIL  ${result.violations.length} source policy violation(s):\n${formatViolations(result.violations)}`);
      diagnostics.info("summary", `Checked ${result.checked} dependency source(s)`);
      process.exit(1);
    } else {
      diagnostics.info("ok", `OK  ${result.checked} dependency source(s) checked — all compliant`);
      process.exit(0);
    }
  } catch (err) {
    diagnostics.error("error", `Error: ${err.message}`);
    process.exit(1);
  }
}