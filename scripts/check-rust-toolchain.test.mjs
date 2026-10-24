// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PINNED_RUST_VERSION,
  inspectRustToolchainToml,
  validateRustToolchain,
} from "./check-rust-toolchain.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-rust-toolchain", () => {
  it("passes on the repository configuration", () => {
    const res = validateRustToolchain(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got errors: ${res.errors.join("; ")}`);
  });

  it("rejects moving stable/nightly channels in rust-toolchain.toml", () => {
    const stableRes = inspectRustToolchainToml(
      '[toolchain]\nchannel = "stable"\ntargets = ["wasm32v1-none"]\n',
    );
    assert.ok(stableRes.errors.some((e) => e.includes('moving channel "stable"')));

    const partialRes = inspectRustToolchainToml(
      '[toolchain]\nchannel = "1.85"\ntargets = ["wasm32v1-none"]\n',
    );
    assert.ok(partialRes.errors.some((e) => e.includes("MAJOR.MINOR.PATCH")));
  });

  it("rejects missing wasm32v1-none target", () => {
    const res = inspectRustToolchainToml(
      `[toolchain]\nchannel = "${PINNED_RUST_VERSION}"\ntargets = []\n`,
    );
    assert.ok(res.errors.some((e) => e.includes("wasm32v1-none")));
  });

  it("rejects drift between rust-toolchain.toml, Cargo.toml, and contract workflows", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rust-toolchain-test-"));
    try {
      mkdirSync(join(tmp, ".github/workflows"), { recursive: true });
      mkdirSync(join(tmp, "docs"), { recursive: true });
      copyFileSync(join(REPO_ROOT, "rust-toolchain.toml"), join(tmp, "rust-toolchain.toml"));
      copyFileSync(join(REPO_ROOT, "docs/CI.md"), join(tmp, "docs/CI.md"));
      writeFileSync(
        join(tmp, "Cargo.toml"),
        '[workspace]\n[workspace.package]\nrust-version = "1.80.0"\n',
      );
      writeFileSync(
        join(tmp, ".github/workflows/contract.yml"),
        "steps:\n  - uses: dtolnay/rust-toolchain@stable\n",
      );
      writeFileSync(
        join(tmp, ".github/workflows/bindings-check.yml"),
        "steps:\n  - uses: dtolnay/rust-toolchain@nightly\n",
      );

      const res = validateRustToolchain(tmp);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes("Cargo.toml rust-version")));
      assert.ok(res.errors.some((e) => e.includes("Rust toolchain action mismatch")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
