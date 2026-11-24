// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_WEB_ROOT,
  discoverWebTestFiles,
  partitionWebTestFiles,
  runWebTests,
} from "../scripts/run-tests.mjs";

test("discoverWebTestFiles discovers all *.test.ts and *.test.tsx files under apps/web deterministically", () => {
  const firstRun = discoverWebTestFiles(DEFAULT_WEB_ROOT);
  const secondRun = discoverWebTestFiles(DEFAULT_WEB_ROOT);

  assert.deepEqual(firstRun, secondRun);
  assert.ok(firstRun.length >= 35, `expected at least 35 web test files, got ${firstRun.length}`);
  assert.ok(firstRun.includes("src/test-discovery.test.ts"));
  assert.ok(firstRun.includes("src/dashboard/fixture-health-check.test.ts"));
  assert.ok(firstRun.includes("src/demo/trace-health-check.test.ts"));
  assert.ok(firstRun.includes("src/hooks/useRoundSession.reveal.test.tsx"));

  for (let i = 1; i < firstRun.length; i++) {
    assert.ok(
      firstRun[i - 1]! < firstRun[i]!,
      `files must be sorted lexicographically: ${firstRun[i - 1]} vs ${firstRun[i]}`,
    );
  }
  for (const file of firstRun) {
    assert.ok(!file.includes("\\"), `expected POSIX path separator in ${file}`);
    assert.match(file, /\.test\.tsx?$/);
    assert.doesNotMatch(file, /^(node_modules|dist|build|coverage)\//);
  }
});

test("adding a new *.test.ts or *.test.tsx file is discovered without editing package.json", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sub-rosa-web-tests-"));
  try {
    mkdirSync(join(tempRoot, "src", "components"), { recursive: true });
    mkdirSync(join(tempRoot, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(tempRoot, "dist"), { recursive: true });

    writeFileSync(
      join(tempRoot, "src", "alpha.test.ts"),
      'import test from "node:test"; test("alpha", () => {});\n',
    );
    writeFileSync(
      join(tempRoot, "src", "components", "beta.test.tsx"),
      'import { mock, test } from "node:test"; mock.module("x", {}); test("beta", () => {});\n',
    );
    writeFileSync(join(tempRoot, "src", "helper.ts"), "export const x = 1;\n");
    writeFileSync(join(tempRoot, "node_modules", "pkg", "ignored.test.ts"), "");
    writeFileSync(join(tempRoot, "dist", "ignored.test.tsx"), "");

    const discovered = discoverWebTestFiles(tempRoot);
    assert.deepEqual(discovered, ["src/alpha.test.ts", "src/components/beta.test.tsx"]);

    const partitioned = partitionWebTestFiles(discovered, tempRoot);
    assert.deepEqual(partitioned, {
      standardTests: ["src/alpha.test.ts"],
      moduleMockTests: ["src/components/beta.test.tsx"],
    });

    const invocations: Array<{ args: readonly string[]; cwd: string }> = [];
    const outcome = runWebTests(tempRoot, {
      spawn: ((_cmd: string, args: readonly string[] = [], opts: { cwd?: string } = {}) => {
        invocations.push({ args, cwd: String(opts.cwd ?? "") });
        return { status: 0 } as ReturnType<typeof import("node:child_process").spawnSync>;
      }) as typeof import("node:child_process").spawnSync,
    });

    assert.equal(outcome.status, 0);
    assert.equal(invocations.length, 2);
    assert.deepEqual(invocations[0]?.args, ["--import", "tsx", "--test", "src/alpha.test.ts"]);
    assert.deepEqual(invocations[1]?.args, [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      "src/components/beta.test.tsx",
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apps/web/package.json test script delegates to scripts/run-tests.mjs without a manual file list", () => {
  const pkgJson = JSON.parse(
    readFileSync(resolve(DEFAULT_WEB_ROOT, "package.json"), "utf8"),
  ) as { scripts?: { test?: string } };

  assert.equal(pkgJson.scripts?.test, "node scripts/run-tests.mjs");
  assert.doesNotMatch(pkgJson.scripts?.test ?? "", /\.test\.tsx?/);
});
