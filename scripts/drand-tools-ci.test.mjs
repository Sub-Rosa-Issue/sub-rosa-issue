// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CI_STEPS,
  TARGET_WORKSPACES,
  runDrandToolsCi,
  verifyDrandToolsCiConfig,
} from "./run-drand-tools-ci.mjs";

const rootPkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("Drand tools CI configuration defines blocking test and typecheck steps in order", () => {
  const verified = verifyDrandToolsCiConfig();
  assert.deepEqual(verified.steps, ["drand-tools:test", "drand-tools:typecheck"]);
  assert.ok(TARGET_WORKSPACES.length >= 1);

  assert.ok(
    rootPkg.scripts["drand-tools:ci"],
    "root script drand-tools:ci must exist",
  );

  let previousIndex = -1;
  for (const step of CI_STEPS) {
    assert.ok(rootPkg.scripts[step], `root script ${step} must exist`);
    const idx = rootPkg.scripts["drand-tools:ci"].indexOf(`pnpm ${step}`);
    assert.ok(
      idx > previousIndex,
      `${step} must run as a blocking step in drand-tools:ci`,
    );
    previousIndex = idx;
  }
});

test("Drand tools CI runner executes each step sequentially and blocks on failure", () => {
  const executed = [];
  runDrandToolsCi(undefined, (_bin, args) => {
    executed.push(args.join(" "));
  });
  assert.deepEqual(
    executed,
    CI_STEPS.map((step) => `run ${step}`),
  );

  assert.throws(
    () =>
      runDrandToolsCi(undefined, (_bin, args) => {
        if (args[1] === CI_STEPS[0]) {
          throw new Error("simulated step failure");
        }
      }),
    /Blocking CI step failed/,
  );
});
