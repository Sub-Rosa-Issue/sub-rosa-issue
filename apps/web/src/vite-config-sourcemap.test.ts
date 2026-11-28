// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBuildSourcemap } from "../vite.config";

test("build disables source maps by default, including custom build modes", () => {
  assert.equal(resolveBuildSourcemap("build", "production", {}), false);
  assert.equal(resolveBuildSourcemap("build", "staging", {}), false);
  assert.equal(resolveBuildSourcemap("build", "production", { WEB_BUILD_SOURCEMAP: "" }), false);
  assert.equal(resolveBuildSourcemap("build", "production", { WEB_BUILD_SOURCEMAP: "false" }), false);
});

test("production build allows explicitly hidden source maps", () => {
  assert.equal(resolveBuildSourcemap("build", "production", { WEB_BUILD_SOURCEMAP: "true" }), "hidden");
  assert.equal(resolveBuildSourcemap("build", "production", { WEB_BUILD_SOURCEMAP: "1" }), "hidden");
  assert.equal(resolveBuildSourcemap("build", "production", { WEB_BUILD_SOURCEMAP: "hidden" }), "hidden");
});

test("serve keeps source maps enabled for development and custom modes", () => {
  assert.equal(resolveBuildSourcemap("serve", "development", {}), true);
  assert.equal(resolveBuildSourcemap("serve", "test", {}), true);
  assert.equal(resolveBuildSourcemap("serve", "staging", {}), true);
});
