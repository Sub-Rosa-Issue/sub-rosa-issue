// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CI_STEPS,
  TARGET_WORKSPACES,
  runReceiptCliCi,
  verifyReceiptCliCiConfig,
} from "./run-receipt-cli-ci.mjs";

const rootPkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("Receipt CLI CI configuration defines blocking test and typecheck steps in order", () => {
  const verified = verifyReceiptCliCiConfig();
  assert.deepEqual(verified.steps, ["receipt-cli:test", "receipt-cli:typecheck"]);
  assert.ok(TARGET_WORKSPACES.length >= 1);

  assert.ok(
    rootPkg.scripts["receipt-cli:ci"],
    "root script receipt-cli:ci must exist",
  );

  let previousIndex = -1;
  for (const step of CI_STEPS) {
    assert.ok(rootPkg.scripts[step], `root script ${step} must exist`);
    const idx = rootPkg.scripts["receipt-cli:ci"].indexOf(`pnpm ${step}`);
    assert.ok(
      idx > previousIndex,
      `${step} must run as a blocking step in receipt-cli:ci`,
    );
    previousIndex = idx;
  }
});

test("Receipt CLI CI runner executes each step sequentially and blocks on failure", () => {
  const executed = [];
  runReceiptCliCi(undefined, (_bin, args) => {
    executed.push(args.join(" "));
  });
  assert.deepEqual(
    executed,
    CI_STEPS.map((step) => `run ${step}`),
  );

  assert.throws(
    () =>
      runReceiptCliCi(undefined, (_bin, args) => {
        if (args[1] === CI_STEPS[0]) {
          throw new Error("simulated step failure");
        }
      }),
    /Blocking CI step failed/,
  );
});
