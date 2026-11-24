// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkFontAssets,
  verifyFontMagicBytes,
  WOFF_MAGIC,
  WOFF2_MAGIC
} from "./check-font-assets.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./check-font-assets.mjs", import.meta.url));

test("verifyFontMagicBytes accepts valid WOFF and WOFF2 files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-fonts-valid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const validWoff = join(dir, "font.woff");
  const validWoff2 = join(dir, "font.woff2");

  writeFileSync(validWoff, Buffer.concat([WOFF_MAGIC, Buffer.from("dummy-font-payload")]));
  writeFileSync(validWoff2, Buffer.concat([WOFF2_MAGIC, Buffer.from("dummy-font-payload")]));

  assert.strictEqual(verifyFontMagicBytes(validWoff), true);
  assert.strictEqual(verifyFontMagicBytes(validWoff2), true);
});

test("verifyFontMagicBytes rejects text-disguised-as-font files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-fonts-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const fakeWoff = join(dir, "exploit.woff");
  const fakeWoff2 = join(dir, "malicious.woff2");
  const shortFile = join(dir, "tiny.woff");

  writeFileSync(fakeWoff, "alert('evil payload embedded as text');");
  writeFileSync(fakeWoff2, "<script>console.log('not a font')</script>");
  writeFileSync(shortFile, "hi");

  assert.strictEqual(verifyFontMagicBytes(fakeWoff), false);
  assert.strictEqual(verifyFontMagicBytes(fakeWoff2), false);
  assert.strictEqual(verifyFontMagicBytes(shortFile), false);
});

test("checkFontAssets reports only invalid font paths", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-font-assets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const valid = join(dir, "valid.woff2");
  const invalid = join(dir, "fake.woff");

  writeFileSync(valid, Buffer.concat([WOFF2_MAGIC, Buffer.from("data")]));
  writeFileSync(invalid, "console.log('javascript payload');");

  const invalidList = checkFontAssets([valid, invalid], dir);
  assert.deepStrictEqual(invalidList, ["fake.woff"]);
});

test("CLI check exits non-zero and outputs only the invalid path when fonts fail check", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-font-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const fakeFont = join(dir, "disguised-script.woff2");
  writeFileSync(fakeFont, "function exploit() { return 42; }");

  // Run script directly in dir containing the invalid font
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: dir,
    encoding: "utf8"
  });

  assert.strictEqual(result.status, 1, "Must exit non-zero on invalid font");
  assert.match(
    result.stderr.trim(),
    /disguised-script\.woff2$/,
    "Must report the invalid font path on stderr"
  );
  assert.strictEqual(result.stdout.trim(), "", "Stdout must be empty (only invalid path reported)");
});

test("CLI check exits 0 when no invalid font assets exist", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-font-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const validFont = join(dir, "Inter.woff2");
  writeFileSync(validFont, Buffer.concat([WOFF2_MAGIC, Buffer.from("font-data")]));

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: dir,
    encoding: "utf8"
  });

  assert.strictEqual(result.status, 0, "Must exit 0 when all fonts are valid");
  assert.strictEqual(result.stderr.trim(), "");
});
