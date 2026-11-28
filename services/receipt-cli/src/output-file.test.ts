// Copyright (c) 2026 Sub Rosa contributors
// Receipt CLI output-file tests: exclusive temporary files, refusal to clobber
// an existing receipt, and cleanup when a write cannot be finalized.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeOutputFile } from "./output-file.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(DIR, "index.ts");
const GOLDEN = resolve(DIR, "fixtures", "golden.json");
const SENTINEL = '{"existing":"receipt that must survive"}\n';

/** A throwaway directory per test, with its own path for cleanup. */
function scratchDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `receipt-cli-${label}-`));
}

/** Temporary files the writer creates are dot-prefixed and suffixed `.tmp-<pid>-<hex>`. */
function tempLeftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".tmp-"));
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, RPC_URL: "", CONTRACT_ID: "" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ── Writer unit tests ─────────────────────────────────────────────────────

test("writes a fresh output through a temp file and leaves none behind", () => {
  const dir = scratchDir("fresh");
  try {
    const out = join(dir, "receipt.json");
    writeOutputFile(out, '{"ok":true}\n');

    assert.equal(readFileSync(out, "utf8"), '{"ok":true}\n');
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.deepEqual(tempLeftovers(dir), []);
    assert.deepEqual(readdirSync(dir), ["receipt.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses an existing non-empty output without truncating or replacing it", () => {
  const dir = scratchDir("refuse");
  try {
    const out = join(dir, "receipt.json");
    writeFileSync(out, SENTINEL, "utf8");

    assert.throws(() => writeOutputFile(out, '{"new":true}\n'), /exists and is not empty/);

    assert.equal(readFileSync(out, "utf8"), SENTINEL);
    assert.deepEqual(tempLeftovers(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("force replaces an existing output only once the new file is complete", () => {
  const dir = scratchDir("force");
  try {
    const out = join(dir, "receipt.json");
    writeFileSync(out, SENTINEL, "utf8");

    writeOutputFile(out, '{"replaced":true}\n', { force: true });

    assert.equal(readFileSync(out, "utf8"), '{"replaced":true}\n');
    assert.deepEqual(tempLeftovers(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removes its temp file when the final rename fails", () => {
  const dir = scratchDir("cleanup");
  try {
    // A directory in place of the output file makes the rename fail; the temp
    // file must not survive it, and the destination must be left alone.
    const out = join(dir, "receipt.json");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "keep", "utf8");

    assert.throws(() => writeOutputFile(out, '{"new":true}\n', { force: true }));

    assert.deepEqual(tempLeftovers(dir), []);
    assert.equal(statSync(out).isDirectory(), true);
    assert.equal(readFileSync(join(out, "keep.txt"), "utf8"), "keep");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses an oversized payload before creating any temp file", () => {
  const dir = scratchDir("size-cap");
  try {
    const out = join(dir, "receipt.json");
    assert.throws(
      () => writeOutputFile(out, "x".repeat(64), { maxBytes: 16 }),
      /Refusing to write/,
    );

    assert.equal(existsSync(out), false);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── CLI-level tests ───────────────────────────────────────────────────────

test("CLI: refuses an existing output file and preserves its contents", () => {
  const dir = scratchDir("cli-refuse");
  try {
    const out = join(dir, "redacted.json");
    writeFileSync(out, SENTINEL, "utf8");

    const { status, stderr } = runCli(["redact", GOLDEN, out]);

    assert.equal(status, 1);
    assert.match(stderr, /exists and is not empty/);
    assert.match(stderr, /--force/);
    assert.equal(readFileSync(out, "utf8"), SENTINEL);
    assert.deepEqual(tempLeftovers(dir), []);
    assert.deepEqual(readdirSync(dir), ["redacted.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: cleans up its temp file when the output cannot be finalized", () => {
  const dir = scratchDir("cli-cleanup");
  try {
    const out = join(dir, "redacted.json");
    mkdirSync(out);

    const { status, stderr } = runCli(["redact", GOLDEN, out, "--force"]);

    assert.equal(status, 1);
    assert.notEqual(stderr.trim(), "");
    assert.deepEqual(tempLeftovers(dir), []);
    assert.equal(statSync(out).isDirectory(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: writes a fresh output file and leaves no temp file behind", () => {
  const dir = scratchDir("cli-happy");
  try {
    const out = join(dir, "redacted.json");

    const { status, stderr } = runCli(["redact", GOLDEN, out]);

    assert.equal(status, 0, stderr);
    const written = readFileSync(out, "utf8");
    assert.doesNotThrow(() => JSON.parse(written));
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.deepEqual(tempLeftovers(dir), []);
    assert.deepEqual(readdirSync(dir), ["redacted.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
