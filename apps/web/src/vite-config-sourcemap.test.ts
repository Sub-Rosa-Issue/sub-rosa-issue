// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBuildSourcemap } from "../vite.config";

test("production build disables public source maps by default", () => {
  assert.equal(resolveBuildSourcemap("production", {}), false);
  assert.equal(resolveBuildSourcemap("production", { WEB_BUILD_SOURCEMAP: "" }), false);
  assert.equal(resolveBuildSourcemap("production", { WEB_BUILD_SOURCEMAP: "false" }), false);
});

test("production build allows explicitly hidden source maps", () => {
  assert.equal(resolveBuildSourcemap("production", { WEB_BUILD_SOURCEMAP: "true" }), "hidden");
  assert.equal(resolveBuildSourcemap("production", { WEB_BUILD_SOURCEMAP: "1" }), "hidden");
  assert.equal(resolveBuildSourcemap("production", { WEB_BUILD_SOURCEMAP: "hidden" }), "hidden");
});

test("development keeps source maps enabled", () => {
  assert.equal(resolveBuildSourcemap("development", {}), true);
  assert.equal(resolveBuildSourcemap("test", {}), true);
});
