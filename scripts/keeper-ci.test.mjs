// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CI_STEPS,
  TARGET_WORKSPACES,
  runKeeperCi,
  verifyKeeperCiConfig,
} from "./run-keeper-ci.mjs";

const rootPkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("Keeper CI configuration defines blocking test and typecheck steps in order", () => {
  const verified = verifyKeeperCiConfig();
  assert.deepEqual(verified.steps, ["keeper:test", "keeper:typecheck"]);
  assert.ok(TARGET_WORKSPACES.length >= 1);

  assert.ok(
    rootPkg.scripts["keeper:ci"],
    "root script keeper:ci must exist",
  );

  let previousIndex = -1;
  for (const step of CI_STEPS) {
    assert.ok(rootPkg.scripts[step], `root script ${step} must exist`);
    const idx = rootPkg.scripts["keeper:ci"].indexOf(`pnpm ${step}`);
    assert.ok(
      idx > previousIndex,
      `${step} must run as a blocking step in keeper:ci`,
    );
    previousIndex = idx;
  }
});

test("Keeper CI runner executes each step sequentially and blocks on failure", () => {
  const executed = [];
  runKeeperCi(undefined, (_bin, args) => {
    executed.push(args.join(" "));
  });
  assert.deepEqual(
    executed,
    CI_STEPS.map((step) => `run ${step}`),
  );

  assert.throws(
    () =>
      runKeeperCi(undefined, (_bin, args) => {
        if (args[1] === CI_STEPS[0]) {
          throw new Error("simulated step failure");
        }
      }),
    /Blocking CI step failed/,
  );
});
