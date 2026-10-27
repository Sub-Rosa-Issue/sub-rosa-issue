// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";

import type { BidState, Round } from "@sub-rosa/sdk";
import { createFakeTime } from "@sub-rosa/time";

import { KeeperCheckpointStore } from "./checkpoint.js";
import {
  DRY_RUN_PHASE_STEP,
  buildKeeperDryRunSummary,
  decideKeeperDryRunAction,
  parseKeeperRunConfig,
  planDryRunCheckpoint,
  type KeeperDryRunReader,
} from "./dry-run.js";

const CONTRACT_ID =
  "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ";

const baseRound = {
  auditor_pubkey: Buffer.alloc(32),
  bidders: ["G1", "G2"],
  clearing_rule: { tag: "HighestBid", values: undefined },
  commit_deadline: 100n,
  item_ref: Buffer.alloc(32),
  operator: "GOPERATOR",
  reveal_deadline: 1_000n,
  reveal_round: 42n,
  status: { tag: "Open", values: undefined },
  winner: undefined,
  winning_bid: 0n,
} as Round;

const bidState = (revealed: boolean): BidState => ({
  commitment: Buffer.alloc(32),
  escrow: 1n,
  revealed_nonce: revealed ? Buffer.alloc(32) : undefined,
  revealed_value: revealed ? 1n : undefined,
  settled: false,
  valid: revealed,
});

describe("parseKeeperRunConfig", () => {
  test("dry-run does not require KEEPER_SECRET", () => {
    const config = parseKeeperRunConfig({
      ROUND_CONTRACT_ID: CONTRACT_ID,
      KEEPER_DRY_RUN: "true",
      ROUND_ID: "7",
    });

    assert.equal(config.dryRun, true);
    assert.equal(config.keeperSecret, undefined);
    assert.equal(config.roundId, 7n);
  });

  test("normal mode keeps KEEPER_SECRET required", () => {
    assert.throws(
      () => parseKeeperRunConfig({ ROUND_CONTRACT_ID: CONTRACT_ID }),
      /missing required env var KEEPER_SECRET/,
    );
  });

  test("requires a contract id in every mode", () => {
    assert.throws(
      () => parseKeeperRunConfig({ KEEPER_DRY_RUN: "true" }),
      /missing required env var ROUND_CONTRACT_ID/,
    );
  });

  test("reports invalid dry-run and numeric values clearly", () => {
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "sometimes",
        }),
      /KEEPER_DRY_RUN must be one of/,
    );
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "true",
          ROUND_ID: "zero",
        }),
      /ROUND_ID must be a positive integer/,
    );
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "true",
          MAX_WAIT_SECONDS: "-1",
        }),
      /MAX_WAIT_SECONDS must be a non-negative finite number/,
    );
  });

  test("rejects credential-bearing RPC_URL values without echoing credentials", () => {
    for (const rpcUrl of [
      "https://keeper-user:keeper-pass@rpc.example.com",
      "https://keeper-user@rpc.example.com",
      "https://:keeper-pass@rpc.example.com",
    ]) {
      assert.throws(
        () =>
          parseKeeperRunConfig({
            ROUND_CONTRACT_ID: CONTRACT_ID,
            KEEPER_DRY_RUN: "true",
            RPC_URL: rpcUrl,
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /RPC_URL: must not contain credentials/);
          assert.doesNotMatch(err.message, /keeper-user|keeper-pass/);
          return true;
        },
      );
    }
  });
});

describe("decideKeeperDryRunAction", () => {
  test("maps each lifecycle state to its next safe action", () => {
    assert.deepEqual(
      decideKeeperDryRunAction(baseRound, 2, 0, 500),
      {
        currentPhase: "awaiting-drand",
        nextAction: "open reveal when the configured Drand round is published",
      },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(baseRound, 2, 0, 5_000),
      { currentPhase: "stale-open", nextAction: "void stale round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        1,
        500,
      ),
      { currentPhase: "revealing", nextAction: "reveal 1 pending bidder" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        2,
        500,
      ),
      {
        currentPhase: "awaiting-clear",
        nextAction: "wait for reveal deadline 1000",
      },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        1,
        1_001,
      ),
      { currentPhase: "ready-to-clear", nextAction: "clear round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Cleared", values: undefined } },
        2,
        2,
      ),
      { currentPhase: "ready-to-settle", nextAction: "settle round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Settled", values: undefined } },
        2,
        2,
      ),
      { currentPhase: "complete", nextAction: "none — round settled" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Voided", values: undefined } },
        2,
        0,
      ),
      {
        currentPhase: "complete",
        nextAction: "none — round voided and escrow refunded",
      },
    );
  });
});

describe("buildKeeperDryRunSummary", () => {
  test("returns a structured summary without calling mutation methods", async () => {
    const reads: string[] = [];
    let mutations = 0;
    const sdk = {
      async getRound(roundId: bigint | number) {
        reads.push(`round:${roundId}`);
        return {
          ...baseRound,
          status: { tag: "Revealing", values: undefined },
        };
      },
      async getBidState(roundId: bigint | number, bidder: string) {
        reads.push(`bid:${roundId}:${bidder}`);
        return bidState(bidder === "G1");
      },
      async openReveal() {
        mutations += 1;
      },
      async reveal() {
        mutations += 1;
      },
      async clear() {
        mutations += 1;
      },
      async settle() {
        mutations += 1;
      },
      async void() {
        mutations += 1;
      },
    };

    const summary = await buildKeeperDryRunSummary(
      sdk as KeeperDryRunReader,
      7n,
      500,
      {
        checkpointPath: "/tmp/dry-run-checkpoint.json",
        network: "Test SDF Network ; September 2015",
        contractId: CONTRACT_ID,
        nowIso: "2026-09-30T00:00:00.000Z",
      },
    );

    assert.deepEqual(summary, {
      mode: "dry-run",
      roundId: 7n,
      status: "Revealing",
      drandRound: 42n,
      bidderCount: 2,
      revealedCount: 1,
      currentPhase: "revealing",
      nextAction: "reveal 1 pending bidder",
      transactionsSubmitted: 0,
      checkpoint: {
        path: "/tmp/dry-run-checkpoint.json",
        network: "Test SDF Network ; September 2015",
        contractId: CONTRACT_ID,
        proposedStep: "reveal",
        mismatch: null,
        filesWritten: 0,
        proposedFile: {
          version: 1,
          network: "Test SDF Network ; September 2015",
          contractId: CONTRACT_ID,
          rounds: {
            "7": {
              roundId: "7",
              completedSteps: ["reveal"],
              lastCompletedStep: "reveal",
              lastTransactionHash: null,
              stepHashes: {},
              updatedAt: "2026-09-30T00:00:00.000Z",
            },
          },
        },
      },
    });
    assert.deepEqual(reads, ["round:7", "bid:7:G1", "bid:7:G2"]);
    assert.equal(mutations, 0);
  });

  test("keeps the summary usable when revealed counts are unavailable", async () => {
    const reader: KeeperDryRunReader = {
      async getRound() {
        return {
          ...baseRound,
          status: { tag: "Revealing", values: undefined },
        };
      },
      async getBidState() {
        throw new Error("bid state unavailable");
      },
    };

    const summary = await buildKeeperDryRunSummary(reader, 1n, 500);

    assert.equal(summary.revealedCount, null);
    assert.equal(summary.currentPhase, "revealing");
    assert.equal(
      summary.nextAction,
      "inspect bidder states and reveal pending bids",
    );
    assert.equal(summary.transactionsSubmitted, 0);
  });
});

describe("dry-run checkpoint preview", () => {
  test("writes nothing to the checkpoint path and submits nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-dry-run-"));
    const checkpointPath = path.join(dir, "checkpoint.json");
    const mutations: string[] = [];
    const reader = {
      async getRound() {
        return { ...baseRound, status: { tag: "Cleared", values: undefined } };
      },
      async getBidState() {
        return bidState(true);
      },
      async settle() {
        mutations.push("settle");
      },
      async clear() {
        mutations.push("clear");
      },
    } as unknown as KeeperDryRunReader;

    try {
      const summary = await buildKeeperDryRunSummary(reader, 3n, 5_000, {
        checkpointPath,
        network: "Test SDF Network ; September 2015",
        contractId: CONTRACT_ID,
        nowIso: "2026-09-30T00:00:00.000Z",
      });

      assert.equal(summary.checkpoint.proposedStep, "settle");
      assert.equal(summary.checkpoint.filesWritten, 0);
      assert.equal(summary.transactionsSubmitted, 0);
      assert.equal(fs.existsSync(checkpointPath), false, "dry-run must not create the file");
      assert.deepEqual(mutations, []);
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("proposes the same file content the live keeper store would write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-dry-run-"));
    const checkpointPath = path.join(dir, "checkpoint.json");
    const options = {
      checkpointPath,
      network: "Test SDF Network ; September 2015",
      contractId: CONTRACT_ID,
      nowIso: "2026-09-30T00:00:00.000Z",
    };

    try {
      const preview = planDryRunCheckpoint(5n, "clear", options);

      const store = new KeeperCheckpointStore({
        path: checkpointPath,
        network: options.network,
        contractId: options.contractId,
        clock: createFakeTime(Date.parse(options.nowIso)).clock,
      });
      store.markComplete(5n, "clear");

      assert.deepEqual(preview.proposedFile, store.snapshot());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a binding conflict that would stop a live keeper", () => {
    const current = {
      version: 1 as const,
      network: "Public Global Stellar Network ; September 2015",
      contractId: CONTRACT_ID,
      rounds: {},
    };

    assert.equal(
      planDryRunCheckpoint(1n, "settle", {
        network: "Test SDF Network ; September 2015",
        contractId: CONTRACT_ID,
        currentCheckpoint: current,
      }).mismatch,
      "network",
    );
    assert.equal(
      planDryRunCheckpoint(1n, "settle", {
        network: current.network,
        contractId: "CDIFFERENT",
        currentCheckpoint: current,
      }).mismatch,
      "contractId",
    );
    assert.equal(
      planDryRunCheckpoint(1n, "settle", {
        network: current.network,
        contractId: current.contractId,
        currentCheckpoint: current,
      }).mismatch,
      null,
    );
  });

  test("proposes no checkpoint change for terminal phases", () => {
    for (const phase of ["awaiting-clear", "complete"] as const) {
      assert.equal(DRY_RUN_PHASE_STEP[phase], null);
      const preview = planDryRunCheckpoint(1n, DRY_RUN_PHASE_STEP[phase], {
        network: "Test SDF Network ; September 2015",
        contractId: CONTRACT_ID,
      });
      assert.equal(preview.proposedStep, null);
      assert.deepEqual(preview.proposedFile.rounds, {});
    }
  });
});
