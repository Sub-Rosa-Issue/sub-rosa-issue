// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/docs-links.yml", import.meta.url),
  "utf8"
);
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

test("docs-links workflow defines branch-scoped concurrency cancellation", () => {
  assert.match(
    workflow,
    /^concurrency:\n(?:\s+#.*\n)*  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m
  );
  assert.match(workflow, /^permissions:\n(?:\s+#.*\n)*  contents: read$/m);
  assert.match(workflow, /run: node scripts\/check-links\.js/);
});

test("docs-links workflow validates deployment documentation (docs:check) on every PR", () => {
  assert.equal(pkg.scripts?.["docs:check"], "node scripts/check-deploy-docs.mjs");
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.doesNotMatch(
    workflow,
    /^  pull_request:\n    paths:/m,
    "pull_request trigger must run on every PR without path-filtering out script/env changes"
  );
  assert.match(workflow, /run: node --test scripts\/check-deploy-docs\.test\.mjs/);
  assert.match(workflow, /run: (?:npm|pnpm) (?:run )?docs:check/);
});
