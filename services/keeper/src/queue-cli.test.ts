import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("queue CLI rejects an invalid round ID without persisting it", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sub-rosa-queue-"));
  const storePath = join(tempDir, "keeper-store.json");

  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/queue.ts", "add", "not-a-round"],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, KEEPER_STORE_PATH: storePath },
        encoding: "utf-8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /roundId must be a positive integer/);
    assert.equal(existsSync(storePath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
