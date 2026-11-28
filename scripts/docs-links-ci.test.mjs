// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/docs-links.yml", import.meta.url),
  "utf8"
);

test("docs-links workflow defines branch-scoped concurrency cancellation", () => {
  assert.match(
    workflow,
    /^concurrency:\n(?:\s+#.*\n)*  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m
  );
  assert.match(workflow, /^permissions:\n(?:\s+#.*\n)*  contents: read$/m);
  assert.match(workflow, /run: node scripts\/check-deploy-docs\.mjs/);
  assert.match(workflow, /run: node scripts\/check-links\.js/);
});

test("docs-links workflow validates deployment documentation alongside link check", () => {
  assert.match(
    workflow,
    /- name: Validate deployment documentation\s*\n\s*run: node scripts\/check-deploy-docs\.mjs/
  );
});
