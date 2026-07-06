import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpc } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Err,
  Ok,
  type Result,
} from "@stellar/stellar-sdk/contract";

import { SubRosaClient } from "./client.js";
import { SubRosaClientConfigError, SubRosaPreflightError } from "./errors.js";
import {
  contractErrorCode,
  evaluatePreflight,
  type PreflightOperation,
} from "./preflight.js";

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y",
};

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function baseSimulation(): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: "1",
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: {} as rpc.Api.SimulateTransactionSuccessResponse["transactionData"],
    minResourceFee: "24500",
    result: {
      auth: [],
      retval: {} as never,
    },
  };
}

function simulationError(error: string): rpc.Api.SimulateTransactionErrorResponse {
  return {
    id: "1",
    latestLedger: 100,
    events: [],
    _parsed: true,
    error,
  };
}

function mockResources(instructions: number, readOnly: number, readWrite: number) {
  return {
    instructions: () => BigInt(instructions),
    footprint: () => ({
      readOnly: () => Array.from({ length: readOnly }),
      readWrite: () => Array.from({ length: readWrite }),
    }),
  };
}

function mockTransactionData(
  resources = mockResources(120_000, 4, 2),
) {
  return {
    resources: () => resources,
  };
}

function mockAssembledTransaction<T>(
  operation: PreflightOperation,
  options: {
    simulation?: rpc.Api.SimulateTransactionResponse;
    parsed?: Result<T>;
    builtFee?: string;
    transactionData?: ReturnType<typeof mockTransactionData>;
    resultThrows?: Error;
  },
): AssembledTransaction<Result<T>> {
  const simulation =
    options.simulation ??
    ({
      ...baseSimulation(),
      result: { auth: [], retval: {} as never },
    } satisfies rpc.Api.SimulateTransactionSuccessResponse);

  return {
    simulation,
    built: options.builtFee ? { fee: options.builtFee } : { fee: "100" },
    get result() {
      if (options.resultThrows) {
        throw options.resultThrows;
      }
      if (!options.parsed) {
        throw new Error(`missing parsed result for ${operation}`);
      }
      return options.parsed;
    },
    get simulationData() {
      const currentSimulation = simulation;
      if (!currentSimulation) {
        throw new AssembledTransaction.Errors.NotYetSimulated(
          "Transaction has not yet been simulated",
        );
      }
      if (rpc.Api.isSimulationError(currentSimulation)) {
        throw new AssembledTransaction.Errors.SimulationFailed(
          `Transaction simulation failed: "${currentSimulation.error}"`,
        );
      }
      if (rpc.Api.isSimulationRestore(currentSimulation)) {
        throw new AssembledTransaction.Errors.ExpiredState(
          "Contract state must be restored",
        );
      }
      return {
        result: { auth: [], retval: {} as never },
        transactionData: options.transactionData ?? mockTransactionData(),
      };
    },
  } as unknown as AssembledTransaction<Result<T>>;
}

describe("evaluatePreflight", () => {
  it("returns success with fee and resource estimates", () => {
    const tx = mockAssembledTransaction<void>("commit", {
      parsed: new Ok(undefined),
      builtFee: "200",
      transactionData: mockTransactionData(mockResources(150_000, 8, 1)),
    });

    const result = evaluatePreflight("commit", tx);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.operation, "commit");
    assert.equal(result.fee.transactionFee, 200);
    assert.equal(result.fee.minResourceFee, 24_500n);
    assert.deepEqual(result.resources, {
      instructions: 150_000,
      readOnlyEntries: 8,
      readWriteEntries: 1,
    });
  });

  it("returns contract_error for decoded Round contract rejections", () => {
    const tx = mockAssembledTransaction<void>("settle", {
      parsed: new Err({ message: "RoundNotFound" }),
    });

    const result = evaluatePreflight("settle", tx);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "contract_error");
    assert.equal(result.error.contractErrorMessage, "RoundNotFound");
    assert.equal(result.error.contractErrorCode, 3);
    assert.match(result.error.message, /Contract rejected call/);
  });

  it("returns simulation_error when RPC reports a simulation failure", () => {
    const tx = mockAssembledTransaction<void>("reveal", {
      simulation: simulationError("HostError: Error(WasmVm, InvalidAction)"),
    });

    const result = evaluatePreflight("reveal", tx);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "simulation_error");
    assert.equal(
      result.error.simulationError,
      "HostError: Error(WasmVm, InvalidAction)",
    );
  });

  it("returns simulation_error when result parsing throws a simulation failure", () => {
    const tx = mockAssembledTransaction<void>("open_reveal", {
      simulation: baseSimulation(),
      resultThrows: new AssembledTransaction.Errors.SimulationFailed(
        'Transaction simulation failed: "insufficient balance"',
      ),
    });

    const result = evaluatePreflight("open_reveal", tx);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "simulation_error");
    assert.match(result.error.message, /insufficient balance/);
  });

  it("returns malformed_response when simulation output is missing", () => {
    const tx = {
      built: { fee: "100" },
      get result() {
        throw new Error("not reached");
      },
    } as unknown as AssembledTransaction<Result<void>>;

    const result = evaluatePreflight("void", tx);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "malformed_response");
    assert.match(result.error.message, /Simulation response missing/);
  });
});

describe("contractErrorCode", () => {
  it("maps known Round contract error messages to numeric codes", () => {
    assert.equal(contractErrorCode("CommitClosed"), 10);
    assert.equal(contractErrorCode("UnknownErrorName"), undefined);
  });
});

describe("SubRosaClient preflight helpers", () => {
  it("exposes preflight methods for every mutating round operation", () => {
    const methods = [
      "preflightCreateRound",
      "preflightCommit",
      "preflightOpenReveal",
      "preflightReveal",
      "preflightClear",
      "preflightSettle",
      "preflightVoid",
    ] as const;

    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    for (const method of methods) {
      assert.equal(typeof client[method], "function", `${method} is missing`);
    }
  });

  it("preflightClear returns typed contract rejection without submitting", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    Object.defineProperty(client.contract, "clear", {
      configurable: true,
      value: async () =>
        mockAssembledTransaction<string | null>("clear", {
          parsed: new Err({ message: "NotCleared" }),
        }),
    });

    const result = await client.preflightClear(1);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof SubRosaPreflightError);
    assert.equal(result.error.kind, "contract_error");
    assert.equal(result.error.contractErrorCode, 17);
  });

  it("preflightCommit surfaces RPC failures from simulateTransaction", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    Object.defineProperty(client.contract, "commit", {
      configurable: true,
      value: async () => {
        throw new Error("RPC unavailable");
      },
    });

    const result = await client.preflightCommit({
      roundId: 1,
      sealed: {
        commitment: new Uint8Array(32),
        ciphertext: new Uint8Array(64),
        auditorBlob: new Uint8Array(32),
      },
      escrow: 1_000_000n,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "rpc_error");
    assert.match(result.error.message, /RPC unavailable/);
  });

  it("preflightCreateRound requires an operator source like createRound", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.preflightCreateRound({
        itemRef: new Uint8Array(32),
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaClientConfigError);
        assert.match(error.message, /required to use it as the operator/);
        return true;
      },
    );
  });

  it("submit methods remain available and unchanged", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    Object.defineProperty(client.contract, "settle", {
      configurable: true,
      value: async () => ({
        async signAndSend() {
          return { result: new Ok(undefined) };
        },
      }),
    });

    await assert.doesNotReject(client.settle(1));
  });
});

describe("SubRosaPreflightError", () => {
  it("sets name, kind, and contract metadata", () => {
    const error = new SubRosaPreflightError({
      kind: "contract_error",
      operation: "commit",
      message: "Contract rejected call: CommitClosed",
      contractErrorCode: 10,
      contractErrorMessage: "CommitClosed",
    });

    assert.equal(error.name, "SubRosaPreflightError");
    assert.equal(error.kind, "contract_error");
    assert.equal(error.operation, "commit");
    assert.equal(error.contractErrorCode, 10);
    assert.equal(error.contractErrorMessage, "CommitClosed");
  });
});
