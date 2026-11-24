// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_WORKFLOWS,
  PINNED_RUST_VERSION,
  findWorkflowRustToolchains,
  parseRustToolchainChannel,
  validateRustToolchainAlignment,
} from "./check-rust-toolchain.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-rust-toolchain", () => {
  it("passes on the repository root and keeps contract workflows aligned", () => {
    const res = validateRustToolchainAlignment(REPO_ROOT);
    assert.equal(res.ok, true, `Expected pass, got: ${res.errors.join("; ")}`);
    assert.equal(res.channel, PINNED_RUST_VERSION);
    for (const wf of CONTRACT_WORKFLOWS) {
      assert.ok(
        res.entries.some(
          (e) =>
            e.file === wf &&
            e.refVersion === PINNED_RUST_VERSION &&
            e.toolchain === PINNED_RUST_VERSION,
        ),
        `Expected ${wf} to pin Rust ${PINNED_RUST_VERSION}`,
      );
    }
  });

  it("rejects moving channel names like stable or nightly in rust-toolchain.toml", () => {
    assert.throws(
      () => parseRustToolchainChannel('[toolchain]\nchannel = "stable"\n'),
      /explicit X\.Y\.Z version/,
    );
    assert.throws(
      () => parseRustToolchainChannel('[toolchain]\nchannel = "nightly"\n'),
      /explicit X\.Y\.Z version/,
    );
  });

  it("extracts toolchain versions from workflow YAML content", () => {
    const fakeFiles = {
      "contract.yml":
        'steps:\n  - uses: dtolnay/rust-toolchain@1.85.0\n    with:\n      toolchain: "1.85.0"\n',
    };
    const entries = findWorkflowRustToolchains(
      "/workflows",
      (p) => {
        const name = p.split(/[\\/]/).pop();
        return fakeFiles[name] ?? "";
      },
      () => Object.keys(fakeFiles),
    );
    assert.deepEqual(entries, [
      { file: "contract.yml", refVersion: "1.85.0", toolchain: "1.85.0" },
    ]);
  });
});
