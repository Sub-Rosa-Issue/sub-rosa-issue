import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
// checkpoint.ts
//
// Durable watch cursor for the keeper.
//
// The in-memory settlement guard is not enough to survive a restart: if the
// process dies after broadcasting a settle (or clear) transaction but before it
// re-reads the chain, the next process has no idea the step is already in
// flight and happily broadcasts it again. This module persists that cursor to a
// small local JSON file so a restart cannot resettle.
//
// File format (one file per keeper process, bound to one contract + network):
//
//   {
//     "version": 1,
//     "network": "Test SDF Network ; September 2015",
//     "contractId": "C...",
//     "rounds": {
//       "1": {
//         "roundId": "1",
//         "completedSteps": ["open-reveal", "reveal", "clear", "settle"],
//         "lastCompletedStep": "settle",
//         "lastTransactionHash": "0x…",
//         "stepHashes": { "settle": "0x…" },
//         "updatedAt": "2026-09-30T00:00:00.000Z"
//       }
//     }
//   }
//
// Safety rules, in order of precedence:
//
//   1. Binding. The file records the network and contract id it was written
//      for. A mismatch with the process config refuses to start — replaying a
//      cursor recorded against a different contract or network is worse than
//      not having a cursor at all.
//   2. Hash verification. On startup every recorded transaction hash is
//      re-checked. A step whose hash is `failed` or `missing` is rolled back so
//      the step is retried; a `confirmed` hash is trusted even when the RPC
//      replica the keeper reads is still behind.
//   3. Chain reconciliation. Steps with no transaction hash to verify fall back
//      to the on-chain status: if the round never reached the state that proves
//      the step happened, the cursor entry is dropped and the step is retried.
//
// Every mutation is a pure function (`planCheckpointStep`) so the dry-run
// planner can print exactly what a live run would write without touching disk.

import { createLogger, type Logger } from "@sub-rosa/logging";
import * as fs from "fs";
import * as path from "path";
import { systemClock, type Clock } from "@sub-rosa/time";

import { normalizeRoundId, type RoundIdInput } from "./store.js";

const diagnostics = createLogger("services.keeper.src.checkpoint");

/** Schema version of the on-disk checkpoint file. */
export const CHECKPOINT_VERSION = 1;

/** Default checkpoint path, overridable with `KEEPER_CHECKPOINT_PATH`. */
export const DEFAULT_CHECKPOINT_PATH = ".keeper-checkpoint.json";

/**
 * Keeper lifecycle steps tracked by the cursor.
 *
 * `open-reveal` is recorded for auditability but is never used to skip work:
 * whether the reveal window is open is already authoritative on-chain (the round
 * status is `Open` or `Revealing`), so trusting the cursor there could strand a
 * round whose opening transaction never landed.
 */
export type KeeperStep = "open-reveal" | "reveal" | "clear" | "settle" | "void";

/** Steps whose completion is durable in the checkpoint and must not be
 *  re-broadcast after a restart. `open-reveal` is deliberately excluded. */
export const CHECKPOINT_SKIP_STEPS: readonly KeeperStep[] = [
  "reveal",
  "clear",
  "settle",
  "void",
];

/**
 * On-chain statuses that prove each step actually took effect. Used to roll
 * back cursor entries that carry no verifiable transaction hash.
 */
export const STEP_SATISFIED_BY_STATUS: Record<KeeperStep, readonly string[]> = {
  "open-reveal": ["Revealing", "Cleared", "Settled", "Voided"],
  reveal: ["Revealing", "Cleared", "Settled", "Voided"],
  clear: ["Cleared", "Settled", "Voided"],
  settle: ["Settled", "Voided"],
  void: ["Voided"],
};

export interface KeeperCheckpoint {
  roundId: string;
  /** Steps observed complete, in the order the keeper completed them. */
  completedSteps: KeeperStep[];
  /** Most recently completed step — the "last completed step" of the cursor. */
  lastCompletedStep: KeeperStep | null;
  /** Transaction hash of the last completed step, when one was available. */
  lastTransactionHash: string | null;
  /** Per-step transaction hashes, used to re-verify the cursor on startup. */
  stepHashes: Partial<Record<KeeperStep, string>>;
  /** ISO-8601 timestamp of the last checkpoint write for this round. */
  updatedAt: string;
}

export interface KeeperCheckpointFile {
  version: number;
  network: string;
  contractId: string;
  rounds: Record<string, KeeperCheckpoint>;
}

/** Result of re-checking a recorded transaction hash. */
export type TransactionHashStatus = "confirmed" | "failed" | "missing";

/** Injectable hash lookup (an RPC `getTransaction` wrapper in production). */
export type TransactionHashVerifier = (
  transactionHash: string,
) => Promise<TransactionHashStatus>;

export interface CheckpointVerification {
  roundId: string;
  step: KeeperStep;
  transactionHash: string;
  status: TransactionHashStatus;
  /** False when the step was rolled back because the hash did not confirm. */
  retained: boolean;
}

/** Cursor surface consumed by the keeper phases. */
export interface WatchCheckpoint {
  isComplete(roundId: bigint | number, step: KeeperStep): boolean;
  markComplete(
    roundId: bigint | number,
    step: KeeperStep,
    transactionHash?: string | null,
  ): void;
  read(roundId: bigint | number): KeeperCheckpoint | undefined;
}

/** Cursor plus the startup resume surface used by the watch loop. */
export interface ResumableCheckpoint extends WatchCheckpoint {
  listRoundIds(): bigint[];
  verifyHashes(verify?: TransactionHashVerifier): Promise<CheckpointVerification[]>;
  reconcile(roundId: bigint | number, observedStatus: string): KeeperStep[];
}

/** Base class for checkpoint failures that must stop the process. */
export class KeeperCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeeperCheckpointError";
  }
}

/** Raised when the checkpoint file was written for another contract/network. */
export class KeeperCheckpointMismatchError extends KeeperCheckpointError {
  constructor(
    readonly field: "network" | "contractId",
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `refusing to start: checkpoint ${field} ${JSON.stringify(actual)} does not match process config ${JSON.stringify(expected)}`,
    );
    this.name = "KeeperCheckpointMismatchError";
  }
}

/**
 * Compare a checkpoint file's binding against the process configuration.
 * Returns the mismatching field, or `null` when the cursor may be resumed.
 */
export function checkpointBindingMismatch(
  file: Pick<KeeperCheckpointFile, "network" | "contractId">,
  config: { network: string; contractId: string },
): "network" | "contractId" | null {
  if (file.network !== config.network) return "network";
  if (file.contractId !== config.contractId) return "contractId";
  return null;
}

export interface KeeperCheckpointStoreOptions {
  /** File path. Defaults to `KEEPER_CHECKPOINT_PATH`, then `.keeper-checkpoint.json`. */
  path?: string;
  network: string;
  contractId: string;
  clock?: Clock;
  logger?: Logger;
  /** Track progress in memory only — never write to disk (dry-run mode). */
  dryRun?: boolean;
}

function emptyFile(
  network: string,
  contractId: string,
): KeeperCheckpointFile {
  return { version: CHECKPOINT_VERSION, network, contractId, rounds: {} };
}

/** Placeholder for entries written before a timestamp was recorded. */
const UNKNOWN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function isKeeperStep(value: unknown): value is KeeperStep {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STEP_SATISFIED_BY_STATUS, value)
  );
}

/** Parse one round entry, dropping malformed cursor data. */
function parseCheckpointEntry(
  roundId: string,
  value: unknown,
  logger: Logger,
): KeeperCheckpoint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    logger.warn(
      "checkpoint-dropping-malformed-entry",
      `[Checkpoint] Dropping malformed entry for round ${roundId}: expected an object`,
    );
    return undefined;
  }
  const stored = value as Partial<KeeperCheckpoint>;
  const steps = Array.isArray(stored.completedSteps)
    ? stored.completedSteps.filter(isKeeperStep)
    : [];
  const stepHashes: Partial<Record<KeeperStep, string>> = {};
  if (stored.stepHashes && typeof stored.stepHashes === "object") {
    for (const [step, hash] of Object.entries(stored.stepHashes)) {
      if (isKeeperStep(step) && typeof hash === "string" && hash) {
        stepHashes[step] = hash;
      }
    }
  }
  const lastCompletedStep =
    steps.length > 0 ? steps[steps.length - 1] : null;
  return {
    roundId,
    completedSteps: steps,
    lastCompletedStep,
    lastTransactionHash:
      typeof stored.lastTransactionHash === "string"
        ? stored.lastTransactionHash
        : null,
    stepHashes,
    updatedAt:
      typeof stored.updatedAt === "string"
        ? stored.updatedAt
        : UNKNOWN_TIMESTAMP,
  };
}

/**
 * Pure cursor update. Returns a new file object; never mutates the input and
 * never touches the filesystem, so the dry-run planner can reuse it verbatim.
 */
export function planCheckpointStep(
  file: KeeperCheckpointFile,
  roundId: RoundIdInput,
  step: KeeperStep,
  options: { transactionHash?: string | null; at?: string } = {},
): KeeperCheckpointFile {
  const id = normalizeRoundId(roundId);
  const transactionHash = options.transactionHash ?? null;
  const previous = file.rounds[id];
  const completedSteps = previous
    ? [...previous.completedSteps]
    : [];
  if (!completedSteps.includes(step)) completedSteps.push(step);

  const stepHashes: Partial<Record<KeeperStep, string>> = {
    ...(previous?.stepHashes ?? {}),
  };
  if (transactionHash) stepHashes[step] = transactionHash;
  else delete stepHashes[step];

  const updatedAt = options.at ?? previous?.updatedAt ?? UNKNOWN_TIMESTAMP;
  const entry: KeeperCheckpoint = {
    roundId: id,
    completedSteps,
    lastCompletedStep: step,
    lastTransactionHash: transactionHash,
    stepHashes,
    updatedAt,
  };

  return {
    version: file.version || CHECKPOINT_VERSION,
    network: file.network,
    contractId: file.contractId,
    rounds: { ...file.rounds, [id]: entry },
  };
}

/** Drop a step from the cursor (used when its transaction hash fails). */
export function planCheckpointRollback(
  file: KeeperCheckpointFile,
  roundId: RoundIdInput,
  step: KeeperStep,
): KeeperCheckpointFile {
  const id = normalizeRoundId(roundId);
  const previous = file.rounds[id];
  if (!previous || !previous.completedSteps.includes(step)) return file;
  const completedSteps = previous.completedSteps.filter((s) => s !== step);
  const stepHashes = { ...previous.stepHashes };
  delete stepHashes[step];
  const entry: KeeperCheckpoint = {
    ...previous,
    completedSteps,
    stepHashes,
    lastCompletedStep:
      completedSteps.length > 0 ? completedSteps[completedSteps.length - 1] : null,
    lastTransactionHash:
      completedSteps.length > 0
        ? (stepHashes[completedSteps[completedSteps.length - 1]] ?? null)
        : null,
  };
  return {
    ...file,
    rounds: { ...file.rounds, [id]: entry },
  };
}

/** True when the cursor records `step` as complete for the round. */
export function checkpointHasStep(
  checkpoint: KeeperCheckpoint | undefined,
  step: KeeperStep,
): boolean {
  return checkpoint?.completedSteps.includes(step) ?? false;
}

/**
 * Read a checkpoint file without validating it against any process config.
 * Returns `undefined` when the file is missing, empty, or unparseable — used by
 * the dry-run planner, which must never mutate state.
 */
export function readCheckpointFile(
  filePath: string,
  logger: Logger = diagnostics,
): KeeperCheckpointFile | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return undefined;
    const parsed = JSON.parse(content) as Partial<KeeperCheckpointFile>;
    if (!parsed.rounds || typeof parsed.rounds !== "object") return undefined;
    const rounds: Record<string, KeeperCheckpoint> = {};
    for (const [key, value] of Object.entries(parsed.rounds)) {
      const entry = parseCheckpointEntry(key, value, logger);
      if (entry) rounds[key] = entry;
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : CHECKPOINT_VERSION,
      network: typeof parsed.network === "string" ? parsed.network : "",
      contractId: typeof parsed.contractId === "string" ? parsed.contractId : "",
      rounds,
    };
  } catch (e) {
    logger.warn(
      "checkpoint-failed-to-parse",
      `[Checkpoint] Failed to parse ${filePath}: ${normalizeError(e).message}`,
    );
    return undefined;
  }
}

/**
 * Durable, per-round watch cursor.
 *
 * The constructor refuses to load a file whose network or contract id does not
 * match the process configuration — a cursor recorded against a different
 * deployment is meaningless and unsafe to replay.
 */
export class KeeperCheckpointStore implements ResumableCheckpoint {
  readonly filePath: string;
  readonly dryRun: boolean;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly network: string;
  private readonly contractId: string;
  private data: KeeperCheckpointFile;

  constructor(options: KeeperCheckpointStoreOptions) {
    this.filePath =
      options.path ||
      process.env.KEEPER_CHECKPOINT_PATH ||
      DEFAULT_CHECKPOINT_PATH;
    this.network = options.network;
    this.contractId = options.contractId;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? diagnostics;
    this.dryRun = options.dryRun ?? false;
    this.data = this.load();
  }

  /** Bind check against the process config, then normalize the round entries. */
  private load(): KeeperCheckpointFile {
    if (!fs.existsSync(this.filePath)) {
      return emptyFile(this.network, this.contractId);
    }

    let parsed: KeeperCheckpointFile;
    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      parsed = content.trim() ? (JSON.parse(content) as KeeperCheckpointFile) : emptyFile(this.network, this.contractId);
    } catch (e) {
      this.logger.warn(
        "checkpoint-failed-to-parse",
        `[Checkpoint] Failed to parse ${this.filePath}. Backing up the corrupted file and starting fresh.`,
      );
      try {
        fs.renameSync(
          this.filePath,
          `${this.filePath}.corrupted.${this.clock.nowMs()}`,
        );
      } catch (backupErr) {
        this.logger.error(
          "checkpoint-could-not-backup-corrupted-file",
          "[Checkpoint] Could not back up the corrupted checkpoint file:",
          { "backupErr_0": normalizeError(backupErr) },
        );
      }
      return emptyFile(this.network, this.contractId);
    }

    if (parsed.network !== this.network) {
      throw new KeeperCheckpointMismatchError(
        "network",
        this.network,
        parsed.network,
      );
    }
    if (parsed.contractId !== this.contractId) {
      throw new KeeperCheckpointMismatchError(
        "contractId",
        this.contractId,
        parsed.contractId,
      );
    }
    if (parsed.version !== CHECKPOINT_VERSION) {
      throw new KeeperCheckpointError(
        `unsupported checkpoint version ${JSON.stringify(parsed.version)} in ${this.filePath} (expected ${CHECKPOINT_VERSION})`,
      );
    }
    this.logger.info(
      "checkpoint-resumed",
      `[Checkpoint] resuming ${this.filePath}: ${Object.keys(parsed.rounds ?? {}).length} round cursor(s)`,
    );

    const rounds: Record<string, KeeperCheckpoint> = {};
    for (const [key, value] of Object.entries(parsed.rounds ?? {})) {
      const entry = parseCheckpointEntry(key, value, this.logger);
      if (entry) rounds[key] = entry;
    }
    return { version: CHECKPOINT_VERSION, network: this.network, contractId: this.contractId, rounds };
  }

  private save(): void {
    if (this.dryRun) {
      this.logger.info(
        "checkpoint-dry-run-no-write",
        `[Checkpoint] dry-run: not writing ${this.filePath}`,
      );
      return;
    }
    try {
      const dir = path.dirname(this.filePath);
      if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      this.logger.error(
        "checkpoint-failed-to-save",
        `[Checkpoint] Failed to save checkpoint to ${this.filePath}:`,
        { "e_0": normalizeError(e) },
      );
    }
  }

  isComplete(roundId: bigint | number, step: KeeperStep): boolean {
    return checkpointHasStep(this.data.rounds[normalizeRoundId(roundId)], step);
  }

  markComplete(
    roundId: bigint | number,
    step: KeeperStep,
    transactionHash?: string | null,
  ): void {
    this.data = planCheckpointStep(this.data, roundId, step, {
      transactionHash,
      at: this.clock.toISOString(),
    });
    this.save();
  }

  read(roundId: bigint | number): KeeperCheckpoint | undefined {
    return this.data.rounds[normalizeRoundId(roundId)];
  }

  /** Round ids that carry cursor state, ascending. */
  listRoundIds(): bigint[] {
    return Object.keys(this.data.rounds)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
      .map((id) => BigInt(id));
  }

  /** Snapshot of the file exactly as a live run would write it. */
  snapshot(): KeeperCheckpointFile {
    return JSON.parse(JSON.stringify(this.data)) as KeeperCheckpointFile;
  }

  /**
   * Re-verify every recorded transaction hash. Steps whose hash is not
   * `confirmed` are rolled back so the next tick retries them. With no
   * verifier available the recorded hashes are trusted as-is and nothing is
   * rolled back — hash confirmation is a gate, never a requirement to run.
   */
  async verifyHashes(
    verify?: TransactionHashVerifier,
  ): Promise<CheckpointVerification[]> {
    const results: CheckpointVerification[] = [];
    if (!verify) return results;

    let changed = false;
    for (const [id, entry] of Object.entries(this.data.rounds)) {
      for (const [step, hash] of Object.entries(entry.stepHashes)) {
        if (!isKeeperStep(step)) continue;
        let status: TransactionHashStatus;
        try {
          status = await verify(hash);
        } catch (e) {
          // An unreachable RPC must not discard durable progress: treat it as
          // "unverifiable" and keep the cursor.
          this.logger.warn(
            "checkpoint-hash-lookup-failed",
            `[Checkpoint] hash lookup failed for round ${id} step ${step}: ${normalizeError(e).message}`,
          );
          results.push({ roundId: id, step, transactionHash: hash, status: "missing", retained: true });
          continue;
        }
        const retained = status === "confirmed";
        results.push({ roundId: id, step, transactionHash: hash, status, retained });
        if (!retained) {
          this.data = planCheckpointRollback(this.data, id, step);
          changed = true;
          this.logger.warn(
            "checkpoint-rolled-back-step",
            `[Checkpoint] rolling back round ${id} step ${step}: transaction ${hash} is ${status}`,
          );
        }
      }
    }
    if (changed) this.save();
    return results;
  }

  /**
   * Chain reconciliation for cursor entries with no transaction hash to verify.
   * If the observed on-chain status cannot prove a recorded step happened, the
   * step is dropped so the keeper retries it instead of stranding the round.
   */
  reconcile(
    roundId: bigint | number,
    observedStatus: string,
  ): KeeperStep[] {
    const id = normalizeRoundId(roundId);
    const entry = this.data.rounds[id];
    if (!entry) return [];
    const dropped: KeeperStep[] = [];
    for (const step of entry.completedSteps) {
      if (entry.stepHashes[step]) continue; // hash-confirmed: trust the cursor
      if (STEP_SATISFIED_BY_STATUS[step].includes(observedStatus)) continue;
      dropped.push(step);
    }
    if (dropped.length === 0) return dropped;
    for (const step of dropped) {
      this.data = planCheckpointRollback(this.data, roundId, step);
    }
    this.save();
    this.logger.warn(
      "checkpoint-reconciled-with-chain",
      `[Checkpoint] round ${roundId} is ${observedStatus}; dropped unverified cursor steps: ${dropped.join(", ")}`,
    );
    return dropped;
  }
}
