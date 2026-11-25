// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/web.yml", import.meta.url), "utf8");
const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;

test("web CI runs all three root checks as blocking steps in one job", () => {
  assert.match(workflow, /^  push:\n    branches: \[main\]$/m);
  assert.match(workflow, /^  pull_request:$/m);

  const job = workflow.match(/^  web:\n([\s\S]*)$/m)?.[1];
  assert.ok(job, "web job must exist");
  assert.doesNotMatch(job, /^  [a-z][\w-]*:/m, "checks must stay in the web job");
  assert.doesNotMatch(job, /\bcontinue-on-error\s*:/, "checks must block on failure");
  assert.match(job, /^        run: pnpm install --frozen-lockfile --ignore-scripts$/m);

  let previousStep = -1;
  for (const script of ["web:test", "web:typecheck", "web:build"]) {
    assert.ok(scripts[script], `root script ${script} must exist`);
    const step = job.indexOf(`        run: pnpm ${script}\n`);
    assert.ok(step > previousStep, `${script} must run after the preceding check`);
    previousStep = step;
  }
});
