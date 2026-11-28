// Copyright (c) 2026 Sub Rosa contributors
// file-permissions.test.ts
//
// Issue #681: every file the keeper persists holds sensitive round state, so it
// must be owner-only (0600). These tests exercise the actual write paths for the
// store, the queue (which persists through the store) and the watch checkpoint.

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

import { createFakeTime } from "@sub-rosa/time";

import { KeeperCheckpointStore } from "./checkpoint.js";
import { KeeperQueue } from "./queue.js";
import { KeeperStore } from "./store.js";

const OWNER_ONLY = 0o600;
// Windows does not represent POSIX permission bits through stat().mode.
const skip = process.platform === "win32"
  ? "POSIX permission bits are not represented on Windows"
  : false;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function fileMode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-permissions-"));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("keeper state file permissions", () => {
  it("creates the store file owner-only and leaves no temporary file", { skip }, () => {
    withTempDir((dir) => {
      const storePath = path.join(dir, "store.json");
      const store = new KeeperStore(storePath, silentLogger);
      store.addRound(1n, { lastStatus: "Open" });

      assert.equal(fileMode(storePath), OWNER_ONLY);
      assert.deepEqual(fs.readdirSync(dir), ["store.json"]);
    });
  });

  it("creates the queue file owner-only", { skip }, () => {
    withTempDir((dir) => {
      const queuePath = path.join(dir, "queue.json");
      const queue = new KeeperQueue(new KeeperStore(queuePath, silentLogger));
      queue.enqueue(7n, { lastStatus: "Open" });

      assert.equal(fileMode(queuePath), OWNER_ONLY);
    });
  });

  it("tightens an existing store file to owner-only on load", { skip }, () => {
    withTempDir((dir) => {
      const storePath = path.join(dir, "store.json");
      fs.writeFileSync(storePath, JSON.stringify({ rounds: {}, leases: {} }), {
        encoding: "utf-8",
        mode: 0o644,
      });
      fs.chmodSync(storePath, 0o644);

      new KeeperStore(storePath, silentLogger);

      assert.equal(fileMode(storePath), OWNER_ONLY);
    });
  });

  it("creates the checkpoint file owner-only and leaves no temporary file", { skip }, () => {
    withTempDir((dir) => {
      const checkpointPath = path.join(dir, "checkpoint.json");
      const checkpoint = new KeeperCheckpointStore({
        path: checkpointPath,
        network: "Test SDF Network ; September 2015",
        contractId: "CTESTCONTRACT",
        clock: createFakeTime(Date.now()).clock,
        logger: silentLogger,
      });
      checkpoint.markComplete(3n, "reveal", "0xabc");

      assert.equal(fileMode(checkpointPath), OWNER_ONLY);
      assert.deepEqual(fs.readdirSync(dir), ["checkpoint.json"]);
    });
  });

  it("tightens an existing checkpoint file to owner-only on load", { skip }, () => {
    withTempDir((dir) => {
      const checkpointPath = path.join(dir, "checkpoint.json");
      fs.writeFileSync(checkpointPath, JSON.stringify({
        version: 1,
        network: "Test SDF Network ; September 2015",
        contractId: "CTESTCONTRACT",
        rounds: {},
      }), { encoding: "utf-8", mode: 0o644 });
      fs.chmodSync(checkpointPath, 0o644);

      new KeeperCheckpointStore({
        path: checkpointPath,
        network: "Test SDF Network ; September 2015",
        contractId: "CTESTCONTRACT",
        clock: createFakeTime(Date.now()).clock,
        logger: silentLogger,
      });

      assert.equal(fileMode(checkpointPath), OWNER_ONLY);
    });
  });
});
