import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  diffVariants,
  parseErrorsMd,
  parseTypesRs,
} from "./check-round-errors.mjs";

const SCRIPT_PATH = new URL(
  "check-round-errors.mjs",
  import.meta.url,
).pathname;
const PROJECT_ROOT = new URL("..", import.meta.url).pathname;

function runScript(args = [], options = {}) {
  return execFileSync("node", [SCRIPT_PATH, ...args], {
    encoding: "utf-8",
    cwd: PROJECT_ROOT,
    ...options,
  });
}

function runScriptExpectFailure(args = []) {
  try {
    runScript(args);
    return { failed: false, combined: "" };
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    return {
      failed: true,
      combined: (e.stdout ? e.stdout.toString() : "") + (e.stderr ? e.stderr.toString() : e.message),
    };
  }
}

describe("parseTypesRs", () => {
  it("reads every variant from the real types.rs", () => {
    const content = readFileSync(
      join(PROJECT_ROOT, "contracts/round/src/types.rs"),
      "utf-8",
    );
    const variants = parseTypesRs(content);
    assert.equal(variants.length, 27);
    assert.deepEqual(
      variants.find((v) => v.name === "CommitClosed"),
      { name: "CommitClosed", code: 10 },
    );
  });
});

describe("parseErrorsMd", () => {
  it("reads every row from the real ERRORS.md", () => {
    const content = readFileSync(
      join(PROJECT_ROOT, "contracts/round/ERRORS.md"),
      "utf-8",
    );
    const variants = parseErrorsMd(content);
    assert.equal(variants.length, 27);
    assert.deepEqual(
      variants.find((v) => v.name === "InvalidLimit"),
      { name: "InvalidLimit", code: 39 },
    );
  });
});

describe("check-round-errors script", () => {
  it("passes against the real repo sources", () => {
    const result = runScript();
    assert.match(result, /PASS\s+types\.rs and ERRORS\.md list the same error codes\./);
    assert.match(result, /types\.rs : 27 variants/);
    assert.match(result, /ERRORS\.md: 27 rows/);
  });

  it("fails when ERRORS.md is missing a variant", () => {
    const tmp = mkdtempSync(join(tmpdir(), "round-errors-bad-"));
    try {
      const types = join(tmp, "types.rs");
      const doc = join(tmp, "ERRORS.md");
      copyFileSync(join(PROJECT_ROOT, "contracts/round/src/types.rs"), types);
      const realDoc = readFileSync(
        join(PROJECT_ROOT, "contracts/round/ERRORS.md"),
        "utf-8",
      );
      writeFileSync(
        doc,
        realDoc.replace(
          /^\|\s*39\s*\|\s*`InvalidLimit`[^\n]*\n/m,
          "",
        ),
      );
      const outcome = runScriptExpectFailure([types, doc]);
      assert.equal(outcome.failed, true);
      assert.match(outcome.combined, /InvalidLimit/);
      assert.match(outcome.combined, /drift issue/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when numeric codes diverge", () => {
    const left = [{ name: "CommitClosed", code: 10 }];
    const right = [{ name: "CommitClosed", code: 99 }];
    const failures = diffVariants(left, right, "types.rs", "ERRORS.md");
    assert.deepEqual(failures, [
      "CommitClosed code mismatch: types.rs=10, ERRORS.md=99",
    ]);
  });
});
