// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CI_STEPS,
  TARGET_WORKSPACES,
  runTlockCi,
  verifyTlockCiConfig,
} from "./run-tlock-ci.mjs";

const rootPkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("tlock CI configuration defines blocking test and typecheck steps in order", () => {
  const verified = verifyTlockCiConfig();
  assert.deepEqual(verified.steps, ["tlock:test", "tlock:typecheck"]);
  assert.ok(TARGET_WORKSPACES.length >= 1);

  assert.ok(
    rootPkg.scripts["tlock:ci"],
    "root script tlock:ci must exist",
  );

  let previousIndex = -1;
  for (const step of CI_STEPS) {
    assert.ok(rootPkg.scripts[step], `root script ${step} must exist`);
    const idx = rootPkg.scripts["tlock:ci"].indexOf(`pnpm ${step}`);
    assert.ok(
      idx > previousIndex,
      `${step} must run as a blocking step in tlock:ci`,
    );
    previousIndex = idx;
  }
});

test("tlock CI runner executes each step sequentially and blocks on failure", () => {
  const executed = [];
  runTlockCi(undefined, (_bin, args) => {
    executed.push(args.join(" "));
  });
  assert.deepEqual(
    executed,
    CI_STEPS.map((step) => `run ${step}`),
  );

  assert.throws(
    () =>
      runTlockCi(undefined, (_bin, args) => {
        if (args[1] === CI_STEPS[0]) {
          throw new Error("simulated step failure");
        }
      }),
    /Blocking CI step failed/,
  );
});
