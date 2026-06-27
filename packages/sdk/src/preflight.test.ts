import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Api } from "@stellar/stellar-sdk/rpc";
import { Err, Ok } from "@stellar/stellar-sdk/contract";
import type { AssembledTransaction, Result } from "@stellar/stellar-sdk/contract";

import { SubRosaClient } from "./client.js";
import {
  SubRosaClientConfigError,
  SubRosaContractError,
  SubRosaMalformedSimulationError,
  SubRosaPreflightRpcError,
} from "./errors.js";
import { lookupContractError, runPreflight } from "./preflight.js";

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ",
};

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function successSimulation(minResourceFee = "54321") {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 100,
    events: [],
    minResourceFee,
    transactionData: {},
  } as unknown as Api.SimulateTransactionSuccessResponse;
}

function makeFakeTx<T>(
  overrides: {
    simulation?: Api.SimulateTransactionResponse | undefined;
    result?: Result<T>;
    fee?: string;
  },
): AssembledTransaction<Result<T>> {
  const result = overrides.result ?? new Ok(undefined as T);
  return {
    simulation: overrides.simulation,
    options: { fee: overrides.fee ?? "100" },
    get result() {
      return result;
    },
  } as unknown as AssembledTransaction<Result<T>>;
}

describe("lookupContractError", () => {
  it("maps known Round contract error names to codes", () => {
    assert.deepEqual(lookupContractError("CommitClosed"), {
      code: 10,
      name: "CommitClosed",
    });
  });

  it("returns undefined for unknown messages", () => {
    assert.equal(lookupContractError("UnknownError"), undefined);
  });
});

describe("runPreflight", () => {
  it("returns success with result and resource estimates", () => {
    const tx = makeFakeTx({
      simulation: successSimulation("98765"),
      result: new Ok(7n),
      fee: "250",
    });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result, 7n);
    assert.deepEqual(outcome.resources, {
      minResourceFee: "98765",
      fee: "250",
    });
  });

  it("returns contract failure with decoded error and resources", () => {
    const tx = makeFakeTx({
      simulation: successSimulation(),
      result: new Err({ message: "CommitClosed" }),
    });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "contract");
    assert.ok(outcome.error instanceof SubRosaContractError);
    assert.equal(outcome.error.contractErrorCode, 10);
    assert.equal(outcome.error.contractErrorName, "CommitClosed");
    assert.equal(outcome.resources?.minResourceFee, "54321");
  });

  it("returns rpc failure for simulation errors", () => {
    const tx = makeFakeTx({
      simulation: {
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        error: "account not found",
      } as Api.SimulateTransactionErrorResponse,
    });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "rpc");
    assert.ok(outcome.error instanceof SubRosaPreflightRpcError);
    assert.match(outcome.error.message, /account not found/);
  });

  it("returns malformed failure when simulation is missing", () => {
    const tx = makeFakeTx({ simulation: undefined });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "malformed");
    assert.ok(outcome.error instanceof SubRosaMalformedSimulationError);
  });

  it("returns malformed failure when minResourceFee is missing", () => {
    const tx = makeFakeTx({
      simulation: {
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        transactionData: {},
      } as unknown as Api.SimulateTransactionSuccessResponse,
    });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "malformed");
    assert.match(outcome.error.message, /minResourceFee/);
  });

  it("returns malformed failure when simulation error has no message", () => {
    const tx = makeFakeTx({
      simulation: {
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        error: "",
      } as Api.SimulateTransactionErrorResponse,
    });

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "malformed");
  });

  it("returns rpc failure when result access throws SimulationFailedError", () => {
    const tx = {
      simulation: successSimulation(),
      options: { fee: "100" },
      get result() {
        const error = new Error('Transaction simulation failed: "HostError"');
        error.name = "SimulationFailedError";
        throw error;
      },
    } as unknown as AssembledTransaction<Result<void>>;

    const outcome = runPreflight(tx);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, "rpc");
    assert.ok(outcome.error instanceof SubRosaPreflightRpcError);
  });
});

describe("SubRosaClient preflight helpers", () => {
  it("preflightCommit delegates to contract simulation without submitting", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });
    const tx = makeFakeTx({
      simulation: successSimulation(),
      result: new Ok(undefined),
    });

    Object.defineProperty(client.contract, "commit", {
      configurable: true,
      value: async () => tx,
    });

    const outcome = await client.preflightCommit({
      roundId: 1,
      sealed: {
        commitment: new Uint8Array(32),
        ciphertext: new Uint8Array(),
        auditorBlob: new Uint8Array(),
      },
      escrow: 1n,
    });

    assert.equal(outcome.ok, true);
  });

  it("preflightCreateRound rejects missing operator source", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.preflightCreateRound({
        itemRef: new Uint8Array(32),
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      SubRosaClientConfigError,
    );
  });

  it("preflightClear normalizes optional winner to undefined", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });
    const tx = makeFakeTx({
      simulation: successSimulation(),
      result: new Ok(null as unknown as string | undefined),
    });

    Object.defineProperty(client.contract, "clear", {
      configurable: true,
      value: async () => tx,
    });

    const outcome = await client.preflightClear(1);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result, undefined);
  });
});
