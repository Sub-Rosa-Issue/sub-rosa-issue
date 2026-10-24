// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { discoverWebTests } from "../apps/web/scripts/run-tests.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WEB_ROOT = resolve(REPO_ROOT, "apps/web");

describe("web test discovery", () => {
  it("wires apps/web package.json test script to deterministic discovery instead of a manual file list", () => {
    const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts.test, "node scripts/run-tests.mjs");
    assert.doesNotMatch(pkg.scripts.test, /\.test\.tsx?/);
  });

  it("discovers all existing *.test.ts and *.test.tsx files under apps/web/src in sorted order", () => {
    const { all, standard, moduleMocks } = discoverWebTests(WEB_ROOT);
    assert.ok(all.length >= 30, `expected at least 30 web test files, got ${all.length}`);
    assert.equal(all.length, standard.length + moduleMocks.length);

    const sorted = [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(all, sorted, "discovered test list must be deterministically sorted");
    assert.ok(all.includes("src/passkey-session.test.ts"));
    assert.ok(all.includes("src/components/AgentPanels.test.tsx"));
    assert.ok(moduleMocks.includes("src/hooks/useLiveRound.test.tsx"));
  });

  it("automatically discovers newly added *.test.ts and *.test.tsx files without config edits", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-web-tests-"));
    try {
      mkdirSync(join(tmp, "src", "components"), { recursive: true });
      mkdirSync(join(tmp, "src", "hooks"), { recursive: true });
      writeFileSync(
        join(tmp, "src", "components", "Widget.test.tsx"),
        "import { test } from 'node:test'; test('ok', () => {});\n",
      );
      writeFileSync(
        join(tmp, "src", "hooks", "useMocked.test.ts"),
        "import { mock } from 'node:test'; mock.module('foo', {});\n",
      );
      writeFileSync(join(tmp, "src", "components", "helper.ts"), "export const x = 1;\n");

      const { all, standard, moduleMocks } = discoverWebTests(tmp);
      assert.deepEqual(all, [
        "src/components/Widget.test.tsx",
        "src/hooks/useMocked.test.ts",
      ]);
      assert.deepEqual(standard, ["src/components/Widget.test.tsx"]);
      assert.deepEqual(moduleMocks, ["src/hooks/useMocked.test.ts"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
