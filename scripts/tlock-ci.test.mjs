// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/tlock.yml", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Tlock CI installs locked dependencies and runs both root checks in one blocking job", () => {
  assert.match(workflow, /^  push:\n    branches: \[main\]$/m);
  assert.match(workflow, /^  pull_request:$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);

  const job = workflow.match(/^  tlock:\n([\s\S]*)$/m)?.[1];
  assert.ok(job, "Tlock job must exist");
  assert.doesNotMatch(job, /^  [a-z][\w-]*:/m, "checks must stay in the Tlock job");
  assert.doesNotMatch(job, /\bcontinue-on-error\s*:/, "checks must block on failure");
  assert.match(job, /^          persist-credentials: false$/m);
  assert.match(job, /^          version: 10\.13\.1$/m);
  assert.match(job, /^          node-version: "22"$/m);
  assert.match(job, /^      - uses: actions\/checkout@[0-9a-f]{40}$/m);
  assert.match(job, /^      - uses: pnpm\/action-setup@[0-9a-f]{40}$/m);
  assert.match(job, /^      - uses: actions\/setup-node@[0-9a-f]{40}$/m);

  const steps = [
    "node --test scripts/tlock-ci.test.mjs",
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm tlock:test",
    "pnpm tlock:typecheck",
  ];
  let previousStep = -1;
  for (const command of steps) {
    const step = job.indexOf(`        run: ${command}\n`);
    assert.ok(step > previousStep, `${command} must follow the preceding step`);
    previousStep = step;
  }

  assert.equal(pkg.scripts["tlock:test"], "pnpm --filter @sub-rosa/tlock test");
  assert.equal(pkg.scripts["tlock:typecheck"], "pnpm --filter @sub-rosa/tlock typecheck");
});
