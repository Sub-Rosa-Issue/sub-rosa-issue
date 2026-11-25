// Copyright (c) 2026 Sub Rosa contributors
// checkpoint.test.ts
//
// Unit coverage for the durable watch cursor: on-disk schema, startup binding
// validation, transaction-hash verification, chain reconciliation, and the
// no-write dry-run mode.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { createFakeTime } from "@sub-rosa/time";

import {
  CHECKPOINT_SKIP_STEPS,
  CHECKPOINT_VERSION,
  KeeperCheckpointError,
  KeeperCheckpointMismatchError,
  KeeperCheckpointStore,
  checkpointBindingMismatch,
  checkpointHasStep,
  planCheckpointRollback,
  planCheckpointStep,
  readCheckpointFile,
  type KeeperCheckpointFile,
  type KeeperStep,
} from "./checkpoint.js";

const NETWORK = "Test SDF Network ; September 2015";
const OTHER_NETWORK = "Public Global Stellar Network ; September 2015";
const CONTRACT = "CTESTCONTRACT";
const OTHER_CONTRACT = "COTHERCONTRACT";
const START_MS = Date.parse("2026-09-30T00:00:00.000Z");

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let dir: string;
let file: string;

function makeStore(
  overrides: Partial<ConstructorParameters<typeof KeeperCheckpointStore>[0]> = {},
): KeeperCheckpointStore {
  return new KeeperCheckpointStore({
    path: file,
    network: NETWORK,
    contractId: CONTRACT,
    clock: createFakeTime(START_MS).clock,
    logger: silentLogger,
    ...overrides,
  });
}

function readFile(): KeeperCheckpointFile {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as KeeperCheckpointFile;
}

function writeFile(contents: unknown): void {
  fs.writeFileSync(file, JSON.stringify(contents, null, 2), "utf-8");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-checkpoint-"));
  file = path.join(dir, "checkpoint.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("KeeperCheckpointStore persistence", () => {
  test("persists round id, last completed step, transaction hash, and network", () => {
    const store = makeStore();
    store.markComplete(7n, "open-reveal");
    store.markComplete(7n, "reveal");
    store.markComplete(7n, "clear");
    store.markComplete(7n, "settle", "0xsethash");

    const written = readFile();
    assert.equal(written.version, CHECKPOINT_VERSION);
    assert.equal(written.network, NETWORK);
    assert.equal(written.contractId, CONTRACT);
    assert.deepEqual(written.rounds["7"], {
      roundId: "7",
      completedSteps: ["open-reveal", "reveal", "clear", "settle"],
      lastCompletedStep: "settle",
      lastTransactionHash: "0xsethash",
      stepHashes: { settle: "0xsethash" },
      updatedAt: "2026-09-30T00:00:00.000Z",
    });
  });

  test("resumes the cursor across a restart", () => {
    makeStore().markComplete(3n, "clear");

    const resumed = makeStore();
    assert.equal(resumed.isComplete(3n, "clear"), true);
    assert.equal(resumed.isComplete(3n, "settle"), false);
    assert.equal(resumed.isComplete(4n, "clear"), false);
    assert.deepEqual(resumed.listRoundIds(), [3n]);
    assert.equal(resumed.read(3n)?.lastCompletedStep, "clear");
  });

  test("records a step once even when it is replayed", () => {
    const store = makeStore();
    store.markComplete(1n, "settle", "0xabc");
    store.markComplete(1n, "settle", "0xabc");
    assert.deepEqual(store.read(1n)?.completedSteps, ["settle"]);
    assert.deepEqual(store.read(1n)?.stepHashes, { settle: "0xabc" });
  });

  test("orders multiple round cursors numerically", () => {
    const store = makeStore();
    for (const id of [10n, 2n, 7n]) store.markComplete(id, "void");
    assert.deepEqual(store.listRoundIds(), [2n, 7n, 10n]);
  });

  test("starts empty when no file exists yet", () => {
    const store = makeStore();
    assert.deepEqual(store.listRoundIds(), []);
    assert.equal(fs.existsSync(file), false);
  });

  test("backs up a corrupted file instead of replaying garbage", () => {
    fs.writeFileSync(file, "{ not json", "utf-8");
    const store = makeStore();
    assert.deepEqual(store.listRoundIds(), []);
    store.markComplete(1n, "settle");
    const backups = fs.readdirSync(dir).filter((f) => f.includes(".corrupted."));
    assert.equal(backups.length, 1);
  });

  test("drops malformed round entries but keeps valid ones", () => {
    writeFile({
      version: CHECKPOINT_VERSION,
      network: NETWORK,
      contractId: CONTRACT,
      rounds: {
        "1": {
          roundId: "1",
          completedSteps: ["settle", "not-a-step"],
          lastCompletedStep: "settle",
          stepHashes: { settle: 42, void: "0xvoid" },
        },
        "2": "nonsense",
        "3": null,
      },
    });

    const store = makeStore();
    assert.deepEqual(store.listRoundIds(), [1n]);
    assert.deepEqual(store.read(1n)?.completedSteps, ["settle"]);
    assert.deepEqual(store.read(1n)?.stepHashes, { void: "0xvoid" });
  });
});

describe("KeeperCheckpointStore startup validation", () => {
  test("refuses to start when the checkpoint contract id does not match", () => {
    writeFile({
      version: CHECKPOINT_VERSION,
      network: NETWORK,
      contractId: OTHER_CONTRACT,
      rounds: {
        "1": {
          roundId: "1",
          completedSteps: ["settle"],
          lastCompletedStep: "settle",
          lastTransactionHash: null,
          stepHashes: {},
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      },
    });

    assert.throws(
      () => makeStore(),
      (error: unknown) => {
        assert.ok(error instanceof KeeperCheckpointMismatchError);
        assert.equal(error.field, "contractId");
        assert.equal(error.expected, CONTRACT);
        assert.equal(error.actual, OTHER_CONTRACT);
        assert.match(error.message, /refusing to start/);
        return true;
      },
    );
  });

  test("refuses to start when the checkpoint network does not match", () => {
    writeFile({
      version: CHECKPOINT_VERSION,
      network: OTHER_NETWORK,
      contractId: CONTRACT,
      rounds: {},
    });

    assert.throws(
      () => makeStore(),
      (error: unknown) => {
        assert.ok(error instanceof KeeperCheckpointMismatchError);
        assert.equal(error.field, "network");
        return true;
      },
    );
  });

  test("refuses to start on an unsupported schema version", () => {
    writeFile({ version: 99, network: NETWORK, contractId: CONTRACT, rounds: {} });
    assert.throws(() => makeStore(), KeeperCheckpointError);
  });

  test("resumes when the binding matches", () => {
    writeFile({
      version: CHECKPOINT_VERSION,
      network: NETWORK,
      contractId: CONTRACT,
      rounds: {
        "5": {
          roundId: "5",
          completedSteps: ["settle"],
          lastCompletedStep: "settle",
          lastTransactionHash: "0xdead",
          stepHashes: { settle: "0xdead" },
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      },
    });
    assert.equal(makeStore().isComplete(5n, "settle"), true);
  });
});

describe("KeeperCheckpointStore hash verification", () => {
  test("keeps steps whose transaction hash is confirmed", async () => {
    const store = makeStore();
    store.markComplete(1n, "settle", "0xgood");

    const results = await store.verifyHashes(async () => "confirmed");

    assert.deepEqual(results, [
      { roundId: "1", step: "settle", transactionHash: "0xgood", status: "confirmed", retained: true },
    ]);
    assert.equal(store.isComplete(1n, "settle"), true);
  });

  test("rolls back a step whose transaction failed", async () => {
    const store = makeStore();
    store.markComplete(1n, "clear", "0xbad");
    store.markComplete(1n, "settle", "0xgood");

    const results = await store.verifyHashes(async (hash) =>
      hash === "0xbad" ? "failed" : "confirmed",
    );

    assert.equal(results.find((r) => r.step === "clear")?.retained, false);
    assert.equal(store.isComplete(1n, "clear"), false);
    assert.equal(store.isComplete(1n, "settle"), true);
    assert.equal(store.read(1n)?.lastCompletedStep, "settle");
    assert.deepEqual(readFile().rounds["1"].completedSteps, ["settle"]);
  });

  test("rolls back a step whose transaction the network never saw", async () => {
    const store = makeStore();
    store.markComplete(2n, "settle", "0xghost");

    const results = await store.verifyHashes(async () => "missing");

    assert.equal(results[0].status, "missing");
    assert.equal(results[0].retained, false);
    assert.equal(store.isComplete(2n, "settle"), false);
    assert.deepEqual(store.read(2n)?.completedSteps, []);
    assert.equal(store.read(2n)?.lastCompletedStep, null);
    assert.equal(store.read(2n)?.lastTransactionHash, null);
  });

  test("is a no-op when no verifier is available", async () => {
    const store = makeStore();
    store.markComplete(1n, "settle", "0xgood");
    assert.deepEqual(await store.verifyHashes(), []);
    assert.equal(store.isComplete(1n, "settle"), true);
  });

  test("keeps the cursor when the hash lookup itself fails", async () => {
    const store = makeStore();
    store.markComplete(1n, "settle", "0xgood");

    const results = await store.verifyHashes(async () => {
      throw new Error("rpc unreachable");
    });

    assert.equal(results[0].retained, true);
    assert.equal(store.isComplete(1n, "settle"), true);
  });
});

describe("KeeperCheckpointStore chain reconciliation", () => {
  test("drops hashless steps the on-chain status cannot prove", () => {
    const store = makeStore();
    store.markComplete(1n, "settle");

    const dropped = store.reconcile(1n, "Cleared");

    assert.deepEqual(dropped, ["settle"]);
    assert.equal(store.isComplete(1n, "settle"), false);
  });

  test("keeps hashless steps the on-chain status proves", () => {
    const store = makeStore();
    store.markComplete(1n, "clear");

    assert.deepEqual(store.reconcile(1n, "Settled"), []);
    assert.equal(store.isComplete(1n, "clear"), true);
  });

  test("keeps hash-confirmed steps even when the replica lags behind", () => {
    const store = makeStore();
    store.markComplete(1n, "settle", "0xgood");

    assert.deepEqual(store.reconcile(1n, "Cleared"), []);
    assert.equal(store.isComplete(1n, "settle"), true);
  });

  test("ignores rounds without cursor state", () => {
    const store = makeStore();
    assert.deepEqual(store.reconcile(9n, "Settled"), []);
  });
});

describe("KeeperCheckpointStore dry-run mode", () => {
  test("tracks progress in memory and never writes to disk", () => {
    const store = makeStore({ dryRun: true });
    store.markComplete(1n, "settle", "0xgood");

    assert.equal(store.isComplete(1n, "settle"), true);
    assert.equal(fs.existsSync(file), false, "dry-run must not create the file");

    store.markComplete(1n, "clear");
    assert.deepEqual(store.read(1n)?.completedSteps, ["settle", "clear"]);
    assert.equal(fs.existsSync(file), false);
  });
});

describe("checkpoint helpers", () => {
  test("checkpointHasStep reads the cursor", () => {
    const entry = planCheckpointStep(
      { version: 1, network: NETWORK, contractId: CONTRACT, rounds: {} },
      1n,
      "void",
    ).rounds["1"];
    assert.equal(checkpointHasStep(entry, "void"), true);
    assert.equal(checkpointHasStep(entry, "settle"), false);
    assert.equal(checkpointHasStep(undefined, "void"), false);
  });

  test("checkpointBindingMismatch reports the conflicting field", () => {
    const file2 = { network: NETWORK, contractId: CONTRACT };
    assert.equal(
      checkpointBindingMismatch(file2, { network: NETWORK, contractId: CONTRACT }),
      null,
    );
    assert.equal(
      checkpointBindingMismatch(file2, { network: OTHER_NETWORK, contractId: CONTRACT }),
      "network",
    );
    assert.equal(
      checkpointBindingMismatch(file2, { network: NETWORK, contractId: OTHER_CONTRACT }),
      "contractId",
    );
  });

  test("planCheckpointStep is pure", () => {
    const base: KeeperCheckpointFile = {
      version: 1,
      network: NETWORK,
      contractId: CONTRACT,
      rounds: {},
    };
    const next = planCheckpointStep(base, 1n, "clear", {
      transactionHash: "0xabc",
      at: "2026-09-30T00:00:00.000Z",
    });
    assert.deepEqual(base.rounds, {}, "input file must not be mutated");
    assert.equal(next.rounds["1"].lastTransactionHash, "0xabc");
  });

  test("planCheckpointRollback keeps the remaining cursor intact", () => {
    let file2: KeeperCheckpointFile = {
      version: 1,
      network: NETWORK,
      contractId: CONTRACT,
      rounds: {},
    };
    file2 = planCheckpointStep(file2, 1n, "clear", { transactionHash: "0xclear" });
    file2 = planCheckpointStep(file2, 1n, "settle", { transactionHash: "0xsettle" });
    const rolled = planCheckpointRollback(file2, 1n, "settle");

    assert.deepEqual(rolled.rounds["1"].completedSteps, ["clear"]);
    assert.equal(rolled.rounds["1"].lastCompletedStep, "clear");
    assert.equal(rolled.rounds["1"].lastTransactionHash, "0xclear");
    assert.deepEqual(rolled.rounds["1"].stepHashes, { clear: "0xclear" });
    // The original object is untouched.
    assert.deepEqual(file2.rounds["1"].completedSteps, ["clear", "settle"]);
  });

  test("readCheckpointFile never throws on malformed input", () => {
    assert.equal(readCheckpointFile(path.join(dir, "absent.json")), undefined);
    fs.writeFileSync(file, "{ nope", "utf-8");
    assert.equal(readCheckpointFile(file, silentLogger), undefined);
    writeFile({ version: 1, network: NETWORK, contractId: CONTRACT });
    assert.equal(readCheckpointFile(file, silentLogger)?.rounds, undefined);
  });

  test("open-reveal is not skip-eligible, the irreversible steps are", () => {
    const steps: KeeperStep[] = ["open-reveal", "reveal", "clear", "settle", "void"];
    assert.ok(!CHECKPOINT_SKIP_STEPS.includes("open-reveal"));
    for (const step of steps.filter((s) => s !== "open-reveal")) {
      assert.ok(CHECKPOINT_SKIP_STEPS.includes(step), `${step} should be skip-eligible`);
    }
  });
});
