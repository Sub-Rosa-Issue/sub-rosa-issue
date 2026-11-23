// Copyright (c) 2026 Sub Rosa contributors
import {
  assertNoUrlCredentials,
  type BidState,
  type Round,
  type SubRosaClient,
} from "@sub-rosa/sdk";
import { systemClock } from "@sub-rosa/time";

import { VOID_GRACE_SECONDS } from "./settlement-guard.js";
import {
  CHECKPOINT_VERSION,
  DEFAULT_CHECKPOINT_PATH,
  checkpointBindingMismatch,
  planCheckpointStep,
  type KeeperCheckpointFile,
  type KeeperStep,
} from "./checkpoint.js";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export interface KeeperRunConfig {
  contractId: string;
  roundId: bigint;
  rpcUrl: string;
  networkPassphrase: string;
  dryRun: boolean;
  keeperSecret?: string;
  maxWaitSeconds: number;
}

export type KeeperDryRunPhase =
  | "awaiting-drand"
  | "stale-open"
  | "revealing"
  | "awaiting-clear"
  | "ready-to-clear"
  | "ready-to-settle"
  | "complete";

/** Cursor step each dry-run phase would record on the next live pass. */
export const DRY_RUN_PHASE_STEP: Record<KeeperDryRunPhase, KeeperStep | null> = {
  "awaiting-drand": "open-reveal",
  "stale-open": "void",
  revealing: "reveal",
  "awaiting-clear": null,
  "ready-to-clear": "clear",
  "ready-to-settle": "settle",
  complete: null,
};

export interface KeeperDryRunDecision {
  currentPhase: KeeperDryRunPhase;
  nextAction: string;
}

export interface KeeperDryRunSummary extends KeeperDryRunDecision {
  mode: "dry-run";
  roundId: bigint;
  status: Round["status"]["tag"];
  drandRound: bigint;
  bidderCount: number;
  revealedCount: number | null;
  transactionsSubmitted: 0;
  /** Checkpoint preview — never written to disk by a dry run. */
  checkpoint: KeeperDryRunCheckpoint;
}

export type KeeperDryRunReader = Pick<
  SubRosaClient,
  "getRound" | "getBidState"
>;

/**
 * The checkpoint a live run *would* write for the next step, plus the binding
 * conflict that would stop it. Nothing here is persisted: dry-run neither
 * submits a transaction nor touches the checkpoint file.
 */
export interface KeeperDryRunCheckpoint {
  path: string;
  network: string;
  contractId: string;
  /** Step the next live pass would record, or null when nothing is pending. */
  proposedStep: KeeperStep | null;
  /** Field whose stored value conflicts with the process config, if any. */
  mismatch: "network" | "contractId" | null;
  /** Exact file content a live run would write. */
  proposedFile: KeeperCheckpointFile;
  /** Always 0 — dry-run writes nothing. */
  filesWritten: 0;
}

export interface KeeperDryRunOptions {
  checkpointPath?: string;
  network?: string;
  contractId?: string;
  /** Current on-disk checkpoint, read-only, so the preview includes history. */
  currentCheckpoint?: KeeperCheckpointFile;
  /** ISO timestamp recorded in the preview. Defaults to the system clock. */
  nowIso?: string;
}

function requiredEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function parseBooleanEnv(value: string | undefined, name: string): boolean {
  if (value == null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${name} must be one of true/false, 1/0, yes/no, or on/off`,
  );
}

function parseRoundId(value: string | undefined): bigint {
  const raw = value?.trim() || "1";
  try {
    const roundId = BigInt(raw);
    if (roundId < 1n) throw new Error();
    return roundId;
  } catch {
    throw new Error(`ROUND_ID must be a positive integer, got ${JSON.stringify(raw)}`);
  }
}

function parseMaxWaitSeconds(value: string | undefined): number {
  const raw = value?.trim() || "0";
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      `MAX_WAIT_SECONDS must be a non-negative finite number, got ${JSON.stringify(raw)}`,
    );
  }
  return seconds;
}

export function parseKeeperRunConfig(
  env: Record<string, string | undefined> = process.env,
): KeeperRunConfig {
  const dryRun = parseBooleanEnv(env.KEEPER_DRY_RUN, "KEEPER_DRY_RUN");
  const keeperSecret = env.KEEPER_SECRET?.trim() || undefined;
  if (!dryRun && !keeperSecret) {
    throw new Error(
      "missing required env var KEEPER_SECRET (not required when KEEPER_DRY_RUN=true)",
    );
  }

  const rpcUrl = env.RPC_URL?.trim() || DEFAULT_RPC_URL;
  assertNoUrlCredentials(rpcUrl, "RPC_URL");

  return {
    contractId: requiredEnv(env, "ROUND_CONTRACT_ID"),
    roundId: parseRoundId(env.ROUND_ID),
    rpcUrl,
    networkPassphrase:
      env.NETWORK_PASSPHRASE?.trim() || DEFAULT_NETWORK_PASSPHRASE,
    dryRun,
    ...(keeperSecret ? { keeperSecret } : {}),
    maxWaitSeconds: parseMaxWaitSeconds(env.MAX_WAIT_SECONDS),
  };
}

export function decideKeeperDryRunAction(
  round: Pick<Round, "status" | "reveal_deadline">,
  bidderCount: number,
  revealedCount: number | null,
  nowSeconds = systemClock.nowSeconds(),
): KeeperDryRunDecision {
  switch (round.status.tag) {
    case "Open": {
      const voidAfter = Number(round.reveal_deadline) + VOID_GRACE_SECONDS;
      return nowSeconds > voidAfter
        ? { currentPhase: "stale-open", nextAction: "void stale round" }
        : {
            currentPhase: "awaiting-drand",
            nextAction: "open reveal when the configured Drand round is published",
          };
    }
    case "Revealing": {
      if (nowSeconds > Number(round.reveal_deadline)) {
        return { currentPhase: "ready-to-clear", nextAction: "clear round" };
      }
      const pending =
        revealedCount == null ? null : Math.max(0, bidderCount - revealedCount);
      if (pending == null || pending > 0) {
        return {
          currentPhase: "revealing",
          nextAction:
            pending == null
              ? "inspect bidder states and reveal pending bids"
              : `reveal ${pending} pending bidder${pending === 1 ? "" : "s"}`,
        };
      }
      return {
        currentPhase: "awaiting-clear",
        nextAction: `wait for reveal deadline ${round.reveal_deadline}`,
      };
    }
    case "Cleared":
      return { currentPhase: "ready-to-settle", nextAction: "settle round" };
    case "Settled":
      return { currentPhase: "complete", nextAction: "none — round settled" };
    case "Voided":
      return {
        currentPhase: "complete",
        nextAction: "none — round voided and escrow refunded",
      };
  }
}

async function countRevealedBids(
  reader: KeeperDryRunReader,
  roundId: bigint,
  bidders: string[],
): Promise<number | null> {
  try {
    const states: BidState[] = await Promise.all(
      bidders.map((bidder) => reader.getBidState(roundId, bidder)),
    );
    return states.filter((state) => state.revealed_value != null).length;
  } catch {
    return null;
  }
}

/**
 * Build the checkpoint a live run would write, without writing it.
 *
 * Pure: the returned file object is produced by the same planner the keeper
 * store uses, so a dry run shows byte-for-byte what a live pass would persist.
 */
export function planDryRunCheckpoint(
  roundId: bigint | number,
  step: KeeperStep | null,
  options: KeeperDryRunOptions = {},
): KeeperDryRunCheckpoint {
  const path = options.checkpointPath ?? DEFAULT_CHECKPOINT_PATH;
  const network = options.network ?? "";
  const contractId = options.contractId ?? "";
  const current = options.currentCheckpoint;
  const bound = network !== "" && contractId !== "";
  const mismatch =
    current && bound
      ? checkpointBindingMismatch(current, { network, contractId })
      : null;

  const base: KeeperCheckpointFile = current
    ? {
        version: current.version || CHECKPOINT_VERSION,
        network: current.network,
        contractId: current.contractId,
        rounds: { ...current.rounds },
      }
    : { version: CHECKPOINT_VERSION, network, contractId, rounds: {} };

  const proposedFile = step
    ? planCheckpointStep(base, roundId, step, { at: options.nowIso })
    : base;

  return {
    path,
    network,
    contractId,
    proposedStep: step,
    mismatch,
    proposedFile,
    filesWritten: 0,
  };
}

export async function buildKeeperDryRunSummary(
  reader: KeeperDryRunReader,
  roundId: bigint | number,
  nowSeconds = systemClock.nowSeconds(),
  options: KeeperDryRunOptions = {},
): Promise<KeeperDryRunSummary> {
  const rid = BigInt(roundId);
  const round = await reader.getRound(rid);
  const bidderCount = round.bidders.length;
  const revealedCount = await countRevealedBids(
    reader,
    rid,
    round.bidders,
  );
  const decision = decideKeeperDryRunAction(
    round,
    bidderCount,
    revealedCount,
    nowSeconds,
  );

  return {
    mode: "dry-run",
    roundId: rid,
    status: round.status.tag,
    drandRound: round.reveal_round,
    bidderCount,
    revealedCount,
    ...decision,
    transactionsSubmitted: 0,
    checkpoint: planDryRunCheckpoint(rid, DRY_RUN_PHASE_STEP[decision.currentPhase], {
      ...options,
      nowIso: options.nowIso ?? systemClock.toISOString(),
    }),
  };
}
