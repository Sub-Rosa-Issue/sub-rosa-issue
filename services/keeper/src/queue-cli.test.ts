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

test("queue CLI claims a round once and only its owner can release it", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sub-rosa-queue-"));
  const storePath = join(tempDir, "keeper-store.json");
  const baseEnv = {
    ...process.env,
    KEEPER_STORE_PATH: storePath,
    ROUND_CONTRACT_ID: "CLEASE",
    NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    KEEPER_LEASE_MS: "60000",
  };

  const run = (args: string[], owner: string) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/queue.ts", ...args], {
      cwd: new URL("..", import.meta.url),
      env: { ...baseEnv, KEEPER_OWNER: owner },
      encoding: "utf-8",
    });

  try {
    assert.equal(run(["add", "5"], "operator-a").status, 0);

    const first = run(["claim", "5"], "operator-a");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /Claimed round 5 as operator-a/);

    const blocked = run(["claim", "5"], "operator-b");
    assert.equal(blocked.status, 1, "a second owner must not take the round");
    assert.match(blocked.stderr, /Round 5 is leased by operator-a/);

    const listed = run(["list"], "operator-a");
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /lease: operator-a until \d+/);

    const foreignRelease = run(["release", "5"], "operator-b");
    assert.equal(foreignRelease.status, 1);
    assert.match(foreignRelease.stderr, /no lease held by operator-b/);

    const release = run(["release", "5"], "operator-a");
    assert.equal(release.status, 0, release.stdout + release.stderr);
    assert.match(release.stdout, /Released the 5 lease held by operator-a/);

    const reclaimed = run(["claim", "5"], "operator-b");
    assert.equal(reclaimed.status, 0, reclaimed.stdout + reclaimed.stderr);
    assert.match(reclaimed.stdout, /Claimed round 5 as operator-b/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
