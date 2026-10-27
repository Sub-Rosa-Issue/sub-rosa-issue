// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUDIT_COMMAND,
  INSTALL_COMMAND,
  PINNED_CARGO_AUDIT_VERSION,
  inspectAuditToml,
  inspectCargoLock,
  validateRustAuditSetup,
} from "./check-rust-audit.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-rust-audit", () => {
  it("passes on the repository root configuration", () => {
    const res = validateRustAuditSetup(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got errors: ${res.errors.join("; ")}`);
  });

  it("pins an explicit cargo-audit version with --locked", () => {
    assert.match(PINNED_CARGO_AUDIT_VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(
      INSTALL_COMMAND,
      `cargo install cargo-audit --version ${PINNED_CARGO_AUDIT_VERSION} --locked`,
    );
    assert.equal(AUDIT_COMMAND, "cargo audit --locked --deny warnings");
  });

  it("rejects ignored advisories or missing deny warnings in audit.toml", () => {
    const badToml = `
# cargo-audit ${PINNED_CARGO_AUDIT_VERSION}
[advisories]
ignore = ["RUSTSEC-2024-0001"]
`;
    const res = inspectAuditToml(badToml);
    assert.ok(res.errors.some((e) => e.includes('deny = ["warnings"]')));
    assert.ok(res.errors.some((e) => e.includes("RUSTSEC-2024-0001")));
  });

  it("rejects registry packages missing SHA-256 checksums in Cargo.lock", () => {
    const badLock = `
version = 3

[[package]]
name = "example-crate"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
    const res = inspectCargoLock(badLock);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /missing a 64-hex SHA-256 checksum/);
  });

  it("fails when Cargo.lock or audit.toml is missing in a workspace", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rust-audit-test-"));
    try {
      mkdirSync(join(tmp, "docs"), { recursive: true });
      copyFileSync(join(REPO_ROOT, "package.json"), join(tmp, "package.json"));
      copyFileSync(join(REPO_ROOT, "docs/CI.md"), join(tmp, "docs/CI.md"));
      writeFileSync(join(tmp, "audit.toml"), "# empty\n");
      const res = validateRustAuditSetup(tmp);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes("Missing committed Cargo.lock")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
