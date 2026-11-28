// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/threat-model.yml", import.meta.url),
  "utf8",
);
const scripts = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).scripts;

test("threat-model CI runs threat-model:test and threat-model:check as blocking steps", () => {
  assert.equal(
    scripts["threat-model:check"],
    "node scripts/check-threat-model-anchors.mjs docs/THREAT_MODEL.md",
  );
  assert.equal(
    scripts["threat-model:test"],
    "node --test scripts/check-threat-model-anchors.test.mjs",
  );

  assert.match(workflow, /^permissions:\n(?:\s+#.*\n)*  contents: read$/m);
  assert.match(
    workflow,
    /^concurrency:\n(?:\s+#.*\n)*  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m,
  );
  assert.doesNotMatch(workflow, /\bcontinue-on-error\s*:/);

  assert.match(workflow, /docs\/THREAT_MODEL\.md/);
  assert.match(workflow, /SECURITY\.md/);
  assert.match(workflow, /contracts\/\*\*/);
  assert.match(workflow, /packages\/\*\*/);
  assert.match(workflow, /services\/\*\*/);

  const job = workflow.match(/^  threat-model:\n([\s\S]*)$/m)?.[1];
  assert.ok(job, "threat-model job must exist");
  assert.doesNotMatch(job, /^  [a-z][\w-]*:/m, "checks must stay in the threat-model job");

  let previousStep = -1;
  for (const step of [
    "node --test scripts/threat-model-ci.test.mjs",
    "pnpm threat-model:test",
    "pnpm threat-model:check",
  ]) {
    const index = job.indexOf(`        run: ${step}\n`);
    assert.ok(index > previousStep, `${step} must run as a blocking step in order`);
    previousStep = index;
  }
});
