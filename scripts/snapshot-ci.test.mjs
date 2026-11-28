// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const web = readFileSync(new URL("../.github/workflows/web.yml", import.meta.url), "utf8");
const contract = readFileSync(new URL("../.github/workflows/contract.yml", import.meta.url), "utf8");
const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const webScripts = JSON.parse(readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8")).scripts;

test("web CI blocks on snapshot inventory and dashboard evidence checks", () => {
  assert.equal(scripts["snapshot:check"], "node scripts/check-snapshots.mjs");
  assert.match(web, /^        run: node --test scripts\/snapshot-ci\.test\.mjs$/m);
  assert.match(web, /^        run: pnpm snapshot:check$/m);
  assert.doesNotMatch(web, /\bcontinue-on-error\s*:/);
  assert.ok(web.indexOf("pnpm install --frozen-lockfile --ignore-scripts") < web.indexOf("pnpm snapshot:check"));
  assert.ok(web.indexOf("pnpm snapshot:check") < web.indexOf("pnpm web:test"));
  assert.match(webScripts.test, /src\/dashboard\/fixture-health-check\.test\.ts/);
  assert.match(webScripts.test, /src\/demo\/trace-health-check\.test\.ts/);
});

test("contract CI rejects regenerated or newly created snapshots", () => {
  assert.match(contract, /^        run: cargo test -p sub-rosa-round$/m);
  assert.match(contract, /git diff --exit-code -- contracts\/round\/test_snapshots\/test/);
  assert.match(contract, /git ls-files --others --exclude-standard -- contracts\/round\/test_snapshots\/test/);
  assert.doesNotMatch(contract, /\bcontinue-on-error\s*:/);
  assert.ok(contract.indexOf("cargo test -p sub-rosa-round") < contract.indexOf("git diff --exit-code -- contracts/round/test_snapshots/test"));
});
