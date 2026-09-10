#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createLogger } from '../packages/logging/src/index.cjs';
const ts = createRequire(new URL('../apps/web/package.json', import.meta.url))('typescript');
const root = fileURLToPath(new URL('..', import.meta.url));

export function findViolations(text, filename = 'source.ts') {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const hits = [];
  const reported = new Set();
  function report(node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (!reported.has(line)) { reported.add(line); hits.push(line); }
  }
  function visit(node, caught) {
    let scope = caught;
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      scope = new Set(caught).add(node.variableDeclaration.name.text);
    }
    if (ts.isFunctionLike(node)) {
      scope = new Set(caught);
      for (const p of node.parameters ?? []) {
        if (ts.isIdentifier(p.name) && (/^(?:e|err|error|cause|failure)$/i.test(p.name.text) || /error|failure|message/i.test(node.name?.getText(source) ?? '')) && p.type && [ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.AnyKeyword].includes(p.type.kind)) scope.add(p.name.text);
      }
      if (ts.isCallExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === 'catch') {
        const first = node.parameters[0]?.name;
        if (first && ts.isIdentifier(first)) scope.add(first.text);
      }
    }
    const isCaught = (n) => ts.isIdentifier(n) && scope.has(n.text);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (['String', 'JSON.stringify'].includes(name) && node.arguments.some(isCaught)) report(node);
    }
    if (ts.isPropertyAccessExpression(node) && isCaught(node.expression) && ['message', 'stack'].includes(node.name.text)) report(node);
    if (ts.isElementAccessExpression(node) && isCaught(node.expression) && ts.isStringLiteral(node.argumentExpression) && ['message','stack'].includes(node.argumentExpression.text)) report(node);
    if (ts.isTemplateSpan(node) && isCaught(node.expression)) report(node);
    ts.forEachChild(node, child => visit(child, scope));
  }
  visit(source, new Set());
  return hits;
}
export function scanTree(base = root) {
  const hits = [];
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'target', '.git'].includes(item.name)) continue;
      const full = join(dir, item.name), rel = relative(base, full).replaceAll('\\', '/');
      if (item.isDirectory()) { walk(full); continue; }
      if (!/\.(?:[cm]?js|tsx?)$/.test(item.name) || /\.test\./.test(item.name) || rel.startsWith('packages/round-bindings/')) continue;
      for (const line of findViolations(readFileSync(full, 'utf8'), full)) hits.push({ file: rel, line });
    }
  }
  for (const entry of ['packages','services','apps','scripts']) walk(join(base, entry));
  return hits;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logger = createLogger('scripts.error-normalization'), violations = scanTree();
  if (violations.length) { logger.error('ad-hoc-errors', 'Use the shared error normalization boundary', { violations }); process.exitCode = 1; }
  else logger.info('passed', 'No ad hoc caught-value stringification');
}
