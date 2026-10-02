// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import * as sdk from "./index.js";

/**
 * Public-surface guard.
 *
 * The published SDK surface must match the committed snapshot, and no export
 * may expose secret material (a secret/seed/raw keypair) in its name or type.
 * A new export that legitimately has to mention one must be added to the
 * committed `secretMentionAllowlist` in the same change, making the exception
 * explicit and reviewable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, "index.ts");
const SNAPSHOT_PATH = resolve(HERE, "public-api.snapshot.json");

interface PublicApiSnapshot {
  exports: string[];
  secretMentionAllowlist?: string[];
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as PublicApiSnapshot;
const SNAPSHOT_EXPORTS = snapshot.exports;
const SECRET_MENTION_ALLOWLIST = snapshot.secretMentionAllowlist ?? [];

/** Tokens that must not appear in a public export's name or type signature. */
const FORBIDDEN_TOKEN_GROUPS: readonly string[][] = [
  ["secret"],
  ["seed"],
  ["privatekey", "private_key"],
  ["keypair", "key_pair"],
  ["rawkey", "raw_key"],
  ["signingkey", "signing_key"],
  ["mnemonic"],
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Return the forbidden token group matched in `text`, or `undefined`. */
export function findForbiddenToken(text: string): string | undefined {
  const normalized = normalize(text);
  for (const group of FORBIDDEN_TOKEN_GROUPS) {
    if (group.some((token) => normalized.includes(normalize(token)))) {
      return group[0];
    }
  }
  return undefined;
}

export interface PublicExportDescriptor {
  name: string;
  /** Declaration signature text: parameters/types only, never a body or comment. */
  signature: string;
}

/**
 * Return the exports whose name or signature mentions secret material and that
 * are not on the allowlist. Snapshot membership does NOT exempt an export —
 * only the allowlist does.
 */
export function findSecretBearingExports(
  descriptors: readonly PublicExportDescriptor[],
  allowlist: readonly string[],
): PublicExportDescriptor[] {
  const allowed = new Set(allowlist);
  return descriptors.filter((descriptor) => {
    if (allowed.has(descriptor.name)) return false;
    return Boolean(findForbiddenToken(descriptor.name) || findForbiddenToken(descriptor.signature));
  });
}

function parseSource(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** Extract a body-free signature for an exported declaration named `name`. */
function declarationSignature(source: ts.SourceFile, name: string): string | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      const params = statement.parameters.map((p) => p.getText(source)).join(", ");
      const returns = statement.type ? `: ${statement.type.getText(source)}` : "";
      return `function ${name}(${params})${returns}`;
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      const members: string[] = [];
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) {
          members.push(
            `constructor(${member.parameters.map((p) => p.getText(source)).join(", ")})`,
          );
        } else if (ts.isPropertyDeclaration(member) && member.name) {
          members.push(`${member.name.getText(source)}${member.type ? `: ${member.type.getText(source)}` : ""}`);
        } else if (ts.isMethodDeclaration(member) && member.name) {
          const params = member.parameters.map((p) => p.getText(source)).join(", ");
          members.push(`${member.name.getText(source)}(${params})${member.type ? `: ${member.type.getText(source)}` : ""}`);
        }
      }
      return `class ${name} { ${members.join("; ")} }`;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          return `const ${name}${declaration.type ? `: ${declaration.type.getText(source)}` : ""}`;
        }
      }
    }
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === name
    ) {
      // Type declarations have no body to strip; strip comments instead.
      return statement.getText(source).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    }
  }
  return undefined;
}

/**
 * Read the public value/type surface declared by `index.ts`, resolving each
 * local re-export to its declaration signature. External (non-relative)
 * re-exports are recorded by name only.
 */
export function collectSourceSurface(indexPath: string): PublicExportDescriptor[] {
  const index = parseSource(indexPath);
  const surface: PublicExportDescriptor[] = [];

  for (const statement of index.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const moduleFile = specifier.startsWith(".")
      ? resolve(dirname(indexPath), specifier.replace(/\.js$/, ".ts"))
      : undefined;

    for (const element of statement.exportClause.elements) {
      const name = element.name.text;
      const signature = moduleFile
        ? (declarationSignature(parseSource(moduleFile), name) ?? "")
        : "";
      surface.push({ name, signature });
    }
  }

  return surface;
}

const sourceSurface = collectSourceSurface(INDEX_PATH);

describe("SDK public API snapshot", () => {
  it("matches the committed snapshot exactly (no extras, no omissions)", () => {
    const actual = Object.keys(sdk).sort();
    const expected = [...SNAPSHOT_EXPORTS].sort();

    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));

    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      "Public surface drifted from public-api.snapshot.json",
    );
  });

  it("re-exports every runtime symbol from index.ts", () => {
    const sourceNames = new Set(sourceSurface.map((descriptor) => descriptor.name));
    const missing = Object.keys(sdk).filter((name) => !sourceNames.has(name));
    assert.deepEqual(missing, [], `runtime exports missing from index.ts: ${missing.join(", ")}`);
  });

  it("exposes no secret-bearing export unless allowlisted", () => {
    const offenders = findSecretBearingExports(sourceSurface, SECRET_MENTION_ALLOWLIST);
    assert.deepEqual(
      offenders.map((descriptor) => descriptor.name),
      [],
      "secret-bearing exports must be fixed or added to secretMentionAllowlist",
    );
  });

  it("keeps the snapshot and allowlist in agreement with the surface", () => {
    const names = new Set(sourceSurface.map((descriptor) => descriptor.name));
    const dangling = SECRET_MENTION_ALLOWLIST.filter((name) => !names.has(name));
    assert.deepEqual(dangling, [], `allowlist entries not present in the surface: ${dangling.join(", ")}`);
  });
});

describe("secret-bearing export guard", () => {
  it("rejects an export whose name mentions a seed", () => {
    const offenders = findSecretBearingExports([{ name: "loadSeed", signature: "" }], []);
    assert.deepEqual(offenders.map((o) => o.name), ["loadSeed"]);
  });

  it("rejects a helper whose signature accepts a secret key", () => {
    const offenders = findSecretBearingExports(
      [{ name: "sign", signature: "function sign(payload: string, secretKey: string)" }],
      [],
    );
    assert.deepEqual(offenders.map((o) => o.name), ["sign"]);
  });

  it("rejects a helper whose signature mentions a raw keypair type", () => {
    const offenders = findSecretBearingExports(
      [{ name: "import", signature: "function import(keypair: RawKeypair): void" }],
      [],
    );
    assert.deepEqual(offenders.map((o) => o.name), ["import"]);
  });

  it("fails even when the secret export is in the snapshot, if not allowlisted", () => {
    // Snapshot membership lives elsewhere; the guard only consults the allowlist.
    const descriptors = [{ name: "deriveKeypair", signature: "function deriveKeypair(seed: Uint8Array)" }];
    const offenders = findSecretBearingExports(descriptors, []);
    assert.equal(offenders.length, 1);
  });

  it("allows a secret-bearing export that is explicitly allowlisted", () => {
    const descriptors = [{ name: "SubRosaClient", signature: "class SubRosaClient { secretKey: string }" }];
    const offenders = findSecretBearingExports(descriptors, ["SubRosaClient"]);
    assert.deepEqual(offenders, []);
  });

  it("does not flag innocent bodies that merely mention secrecy in prose", () => {
    const descriptors = [{ name: "summarize", signature: "function summarize(value: string): string" }];
    assert.deepEqual(findSecretBearingExports(descriptors, []), []);
  });
});

describe("snapshot test hermeticity", () => {
  it("does not start a network client while loading the SDK surface", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((..._args: unknown[]) => {
      called = true;
      throw new Error("network access is not allowed in the snapshot test");
    }) as typeof fetch;

    try {
      // Cache-busting specifier forces a fresh evaluation where supported.
      await import(`./index.js?hermetic=${Date.now()}`);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
