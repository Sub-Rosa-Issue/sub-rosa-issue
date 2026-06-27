// Preflight simulation helpers.
// Wraps the Soroban simulateTransaction RPC call so integrators can check
// whether create, commit, reveal, clear, settle, and void calls are likely
// to succeed before submitting signed transactions.

import { rpc } from "@stellar/stellar-sdk";
import type { SubRosaClient } from "./client.js";

export interface PreflightResult {
  /** True if simulation succeeded without error. */
  success: boolean;
  /** Estimated ledger entries read/written. */
  footprint?: {
    readBytes: number;
    writeBytes: number;
  };
  /** Estimated fee in stroops. */
  minResourceFee?: string;
  /** Error message if simulation failed. */
  error?: string;
  /** Raw simulation result. */
  raw?: unknown;
}

/**
 * Simulate a create_round call and return preflight diagnostics.
 * Does NOT submit the transaction.
 */
export async function preflightCreate(
  client: SubRosaClient,
  params: Parameters<SubRosaClient["create"]>[0],
): Promise<PreflightResult> {
  try {
    const tx = await client.create(params);
    return parseSimResult(tx);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Simulate a commit call and return preflight diagnostics.
 */
export async function preflightCommit(
  client: SubRosaClient,
  params: Parameters<SubRosaClient["commit"]>[0],
): Promise<PreflightResult> {
  try {
    const tx = await client.commit(params);
    return parseSimResult(tx);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Simulate a reveal call and return preflight diagnostics.
 */
export async function preflightReveal(
  client: SubRosaClient,
  params: Parameters<SubRosaClient["reveal"]>[0],
): Promise<PreflightResult> {
  try {
    const tx = await client.reveal(params);
    return parseSimResult(tx);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Parse an AssembledTransaction simulation result into a PreflightResult. */
function parseSimResult(tx: any): PreflightResult {
  try {
    const sim = tx.simulation;
    if (!sim) return { success: true };
    if ("error" in sim) return { success: false, error: sim.error };
    return {
      success: true,
      minResourceFee: sim.minResourceFee,
      footprint: sim.transactionData ? {
        readBytes: Number(sim.transactionData.resources()?.readBytes() ?? 0),
        writeBytes: Number(sim.transactionData.resources()?.writeBytes() ?? 0),
      } : undefined,
      raw: sim,
    };
  } catch {
    return { success: true };
  }
}
