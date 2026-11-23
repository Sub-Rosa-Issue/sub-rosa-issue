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
const RELEASE_ASSET = `stellar-cli-${PINNED_VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
const RELEASE_URL = `https://github.com/stellar/stellar-cli/releases/download/v${PINNED_VERSION}/${RELEASE_ASSET}`;
const RELEASE_SHA256 = "faeaec7f7a16c008f25c8b9a6d5fb047831e97b74c85336db4f6ad5877ae9c4f";

describe("bindings-check Stellar CLI pin", () => {
  it("verifies the pinned release checksum before extracting the CLI", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    assert.ok(workflow.includes(`STELLAR_CLI_URL: ${RELEASE_URL}`));
    assert.ok(workflow.includes(`STELLAR_CLI_SHA256: ${RELEASE_SHA256}`));
    assert.match(workflow, /curl .* "\$STELLAR_CLI_URL" -o "\$archive"/);
    assert.match(workflow, /"\$STELLAR_CLI_SHA256" "\$archive" \| sha256sum --check/);
    const verifyAt = workflow.indexOf("sha256sum --check");
    assert.ok(verifyAt < workflow.indexOf("tar -xzf"));
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
    assert.ok(docs.includes(RELEASE_URL));
  });
});
