import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("check-fixture-sizes", () => {
  it("exits 0 when all fixture sizes are within budget", () => {
    const result = execFileSync(
      "node",
      [new URL("check-fixture-sizes.mjs", import.meta.url).pathname],
      { encoding: "utf-8", cwd: new URL("..", import.meta.url).pathname },
    );
    assert.match(result, /All fixture size budgets are within limits/);
  });

  it("reports all three fixture groups", () => {
    const result = execFileSync(
      "node",
      [new URL("check-fixture-sizes.mjs", import.meta.url).pathname],
      { encoding: "utf-8", cwd: new URL("..", import.meta.url).pathname },
    );
    assert.match(result, /Receipt fixtures/);
    assert.match(result, /Contract test snapshots/);
    assert.match(result, /Demo trace outputs/);
  });
});
