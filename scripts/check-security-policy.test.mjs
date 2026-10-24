// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

describe("SECURITY.md policy", () => {
  it("exists at the repository root and is linked from README.md", () => {
    const securityPath = join(REPO_ROOT, "SECURITY.md");
    assert.equal(existsSync(securityPath), true, "SECURITY.md must exist at repo root");

    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    assert.match(readme, /\[SECURITY\.md\]\(\.\/SECURITY\.md\)/);
  });

  it("documents supported versions, private reporting, and the 4-step credential compromise checklist", () => {
    const security = readFileSync(join(REPO_ROOT, "SECURITY.md"), "utf8");
    assert.match(security, /## Supported Versions/);
    assert.match(security, /`main`/);
    assert.match(security, /## Reporting a Vulnerability Privately/);
    assert.match(security, /security\/advisories\/new/);
    for (const step of ["Isolate", "Revoke", "Rotate from a clean machine", "Preserve evidence"]) {
      assert.ok(
        security.includes(step),
        `SECURITY.md must include incident response step: ${step}`,
      );
    }
  });
});
