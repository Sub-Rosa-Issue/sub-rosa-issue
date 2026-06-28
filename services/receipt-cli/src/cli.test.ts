import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runReceiptCli } from "./index.js";

const DIR = dirname(fileURLToPath(import.meta.url));

function captureIo() {
  const lines: string[] = [];
  const io = {
    stdout: { log: (...args: unknown[]) => lines.push(args.join(" ")) },
    stderr: { error: (...args: unknown[]) => lines.push(args.join(" ")) },
  };
  return { io, lines };
}

function makeTempFile(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-cli-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, content, "utf-8");
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("receipt-cli exits 0 when verification succeeds", async () => {
  const fixturePath = resolve(DIR, "fixtures", "golden.json");
  const { io, lines } = captureIo();

  const exitCode = await runReceiptCli(["verify", fixturePath], process.env, io as any);

  assert.equal(exitCode, 0);
  assert.match(lines.join("\n"), /Verification: PASS/);
});

test("receipt-cli exits 1 for invalid usage", async () => {
  const { io, lines } = captureIo();

  const exitCode = await runReceiptCli([], process.env, io as any);

  assert.equal(exitCode, 1);
  assert.match(lines.join("\n"), /Usage:/);
});

test("receipt-cli exits 1 when export is missing CONTRACT_ID", async () => {
  const { io, lines } = captureIo();

  const exitCode = await runReceiptCli(["export", "1"], {}, io as any);

  assert.equal(exitCode, 1);
  assert.match(lines.join("\n"), /CONTRACT_ID env var is required/);
});

test("receipt-cli exits 1 for malformed input", async () => {
  const { filePath, cleanup } = makeTempFile("bad.json", "{not valid json");
  const { io, lines } = captureIo();

  try {
    const exitCode = await runReceiptCli(["verify", filePath], process.env, io as any);

    assert.equal(exitCode, 1);
    assert.match(lines.join("\n"), /Invalid JSON/);
  } finally {
    cleanup();
  }
});

test("receipt-cli exits 1 when verification fails", async () => {
  const fixturePath = resolve(DIR, "fixtures", "tampered-winner.json");
  const { io, lines } = captureIo();

  const exitCode = await runReceiptCli(["verify", fixturePath], process.env, io as any);

  assert.equal(exitCode, 1);
  assert.match(lines.join("\n"), /Verification: FAIL/);
});
