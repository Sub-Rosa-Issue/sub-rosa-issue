import { Api } from "@stellar/stellar-sdk/rpc";
import type { AssembledTransaction, Result } from "@stellar/stellar-sdk/contract";
import { Errors as RoundErrors } from "@sub-rosa/round-bindings";
import {
  SubRosaContractError,
  SubRosaMalformedSimulationError,
  SubRosaPreflightRpcError,
} from "./errors.js";

export interface PreflightResources {
  /** Minimum resource fee (stroops) estimated by Soroban RPC simulation. */
  minResourceFee: string;
  /** Base fee configured on the assembled transaction, when available. */
  fee?: string;
}

export interface PreflightSuccess<T> {
  ok: true;
  result: T;
  resources: PreflightResources;
}

export interface PreflightContractFailure {
  ok: false;
  kind: "contract";
  error: SubRosaContractError;
  resources?: PreflightResources;
}

export interface PreflightRpcFailure {
  ok: false;
  kind: "rpc";
  error: SubRosaPreflightRpcError;
}

export interface PreflightMalformedFailure {
  ok: false;
  kind: "malformed";
  error: SubRosaMalformedSimulationError;
}

export type PreflightFailure =
  | PreflightContractFailure
  | PreflightRpcFailure
  | PreflightMalformedFailure;

export type PreflightResult<T> = PreflightSuccess<T> | PreflightFailure;

export function lookupContractError(
  message: string,
): { code: number; name: string } | undefined {
  for (const [code, entry] of Object.entries(RoundErrors)) {
    if (entry.message === message) {
      return { code: Number(code), name: entry.message };
    }
  }
  return undefined;
}

function extractResources(
  tx: AssembledTransaction<unknown>,
  sim: Api.SimulateTransactionResponse,
): PreflightResources | undefined {
  if (Api.isSimulationRestore(sim)) {
    return {
      minResourceFee: sim.restorePreamble.minResourceFee,
      fee: tx.options.fee,
    };
  }
  if (Api.isSimulationSuccess(sim)) {
    return {
      minResourceFee: sim.minResourceFee,
      fee: tx.options.fee,
    };
  }
  return undefined;
}

function malformed(message: string): PreflightMalformedFailure {
  return {
    ok: false,
    kind: "malformed",
    error: new SubRosaMalformedSimulationError(message),
  };
}

function rpcFailure(message: string, cause?: unknown): PreflightRpcFailure {
  return {
    ok: false,
    kind: "rpc",
    error: new SubRosaPreflightRpcError(message, cause ? { cause } : undefined),
  };
}

function contractFailure(
  message: string,
  resources?: PreflightResources,
): PreflightContractFailure {
  const decoded = lookupContractError(message);
  const code = decoded?.code ?? 0;
  const name = decoded?.name ?? message;
  return {
    ok: false,
    kind: "contract",
    error: new SubRosaContractError(code, name),
    ...(resources ? { resources } : {}),
  };
}

/**
 * Evaluate a simulated Round contract transaction without signing or submitting.
 * Contract calls are simulated when the bindings construct the transaction.
 */
export function runPreflight<T>(
  tx: AssembledTransaction<Result<T>>,
): PreflightResult<T> {
  const sim = tx.simulation;
  if (!sim) {
    return malformed("simulation response is missing");
  }

  if (Api.isSimulationError(sim)) {
    if (typeof sim.error !== "string" || sim.error.length === 0) {
      return malformed("simulation error response is missing an error message");
    }
    return rpcFailure(`transaction simulation failed: ${sim.error}`);
  }

  const resources = extractResources(tx, sim);
  if (!resources?.minResourceFee) {
    return malformed("simulation succeeded but minResourceFee is missing");
  }

  try {
    const result = tx.result;
    if (result.isErr()) {
      return contractFailure(result.unwrapErr().message, resources);
    }
    return {
      ok: true,
      result: result.unwrap(),
      resources,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "SimulationFailedError") {
      return rpcFailure(e.message, e);
    }
    throw e;
  }
}
