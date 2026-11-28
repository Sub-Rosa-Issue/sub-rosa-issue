// Copyright (c) 2026 Sub Rosa contributors
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../.github/workflows/bindings-check.yml", import.meta.url),
);
const DOCS_PATH = fileURLToPath(new URL("../docs/CI.md", import.meta.url));

const PINNED_VERSION = "22.8.2";
const INSTALL_COMMAND = `cargo install stellar-cli --version ${PINNED_VERSION} --locked`;

describe("bindings-check Stellar CLI pin", () => {
  it("installs an explicit stellar-cli version with --locked", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(workflow, new RegExp(INSTALL_COMMAND.replace(/[.]/g, "\\.")));
    assert.doesNotMatch(
      workflow,
      /cargo install stellar-cli --locked(?!\s*--version)/,
    );
  });

  it("prints stellar --version before pnpm bindings:check", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const versionAt = workflow.indexOf("stellar --version");
    const checkAt = workflow.indexOf("pnpm bindings:check");
    assert.ok(versionAt >= 0, "workflow must print stellar --version");
    assert.ok(checkAt >= 0, "workflow must run pnpm bindings:check");
    assert.ok(
      versionAt < checkAt,
      "stellar --version must run before pnpm bindings:check",
    );
  });

  it("documents the pinned CLI version", () => {
    const docs = readFileSync(DOCS_PATH, "utf8");
    assert.match(docs, new RegExp(`Stellar CLI \\*\\*${PINNED_VERSION}\\*\\*`));
    assert.match(docs, new RegExp(INSTALL_COMMAND.replace(/[.]/g, "\\.")));
  });
});
