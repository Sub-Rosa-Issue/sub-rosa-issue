// Persisted watch queue for the keeper watch mode.
//
// Store format: a versioned JSON file that is safe to inspect and edit manually.
// Each entry tracks one watched round: its identity, last observed status,
// retry metadata, and timestamps. See docs/KEEPER_QUEUE.md for the full schema.
//
// Store path: WATCH_QUEUE_FILE env var, default "keeper-queue.json" in cwd.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export const QUEUE_VERSION = 1;
export const DEFAULT_QUEUE_FILE = "keeper-queue.json";

/**
 * One entry in the persisted watch queue.
 *
 * Numeric fields (roundId, revealRound) are stored as decimal strings so
 * JSON round-trips do not lose precision on large BigInts.
 * "unknown" means the value was not available when the entry was created.
 */
export interface WatchedRound {
  roundId: string;
  contractId: string;
  network: string;
  revealRound: string;
  lastStatus: string;
  retryCount: number;
  lastRetryAt: string | null;
  lastAction: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchQueue {
  version: number;
  rounds: WatchedRound[];
}

function emptyQueue(): WatchQueue {
  return { version: QUEUE_VERSION, rounds: [] };
}

/** Load the queue from disk. Returns an empty queue on missing or corrupt file. */
export function loadQueue(storePath: string): WatchQueue {
  if (!existsSync(storePath)) return emptyQueue();
  let raw: string;
  try {
    raw = readFileSync(storePath, "utf-8");
  } catch {
    console.warn(`queue: cannot read ${storePath} — starting with empty queue`);
    return emptyQueue();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).version !== "number" ||
      !Array.isArray((parsed as Record<string, unknown>).rounds)
    ) {
      console.warn(
        `queue: ${storePath} has unexpected structure — starting with empty queue`,
      );
      return emptyQueue();
    }
    return parsed as WatchQueue;
  } catch {
    console.warn(
      `queue: ${storePath} is not valid JSON — starting with empty queue`,
    );
    return emptyQueue();
  }
}

/** Atomically write the queue (write to a temp file then rename). */
export function saveQueue(storePath: string, queue: WatchQueue): void {
  const tmp = `${storePath}.tmp.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(queue, null, 2) + "\n", "utf-8");
  renameSync(tmp, storePath);
}

function roundKey(roundId: string | bigint, contractId: string): string {
  return `${String(roundId)}:${contractId}`;
}

/**
 * Add a round to the queue. If an entry with the same roundId+contractId
 * already exists, the existing entry is returned unchanged (no duplicate).
 */
export function addRound(
  storePath: string,
  entry: {
    roundId: bigint;
    contractId: string;
    network: string;
    revealRound?: bigint;
  },
): { entry: WatchedRound; added: boolean } {
  const queue = loadQueue(storePath);
  const key = roundKey(entry.roundId, entry.contractId);
  const existing = queue.rounds.find(
    (r) => roundKey(r.roundId, r.contractId) === key,
  );
  if (existing) return { entry: existing, added: false };

  const now = new Date().toISOString();
  const newEntry: WatchedRound = {
    roundId: String(entry.roundId),
    contractId: entry.contractId,
    network: entry.network,
    revealRound:
      entry.revealRound != null ? String(entry.revealRound) : "unknown",
    lastStatus: "unknown",
    retryCount: 0,
    lastRetryAt: null,
    lastAction: null,
    createdAt: now,
    updatedAt: now,
  };
  queue.rounds.push(newEntry);
  saveQueue(storePath, queue);
  return { entry: newEntry, added: true };
}

/** Return all rounds in the queue. */
export function listRounds(storePath: string): WatchedRound[] {
  return loadQueue(storePath).rounds;
}

/**
 * Remove a round from the queue. Returns true if found and removed,
 * false if no matching entry exists.
 */
export function removeRound(
  storePath: string,
  roundId: bigint,
  contractId: string,
): boolean {
  const queue = loadQueue(storePath);
  const key = roundKey(roundId, contractId);
  const before = queue.rounds.length;
  queue.rounds = queue.rounds.filter(
    (r) => roundKey(r.roundId, r.contractId) !== key,
  );
  if (queue.rounds.length === before) return false;
  saveQueue(storePath, queue);
  return true;
}

/**
 * Patch a queue entry in place. Returns false if no matching entry exists.
 * `updatedAt` is always set to the current time.
 */
export function updateRound(
  storePath: string,
  roundId: bigint,
  contractId: string,
  patch: Partial<Omit<WatchedRound, "roundId" | "contractId" | "createdAt">>,
): boolean {
  const queue = loadQueue(storePath);
  const key = roundKey(roundId, contractId);
  const entry = queue.rounds.find(
    (r) => roundKey(r.roundId, r.contractId) === key,
  );
  if (!entry) return false;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  saveQueue(storePath, queue);
  return true;
}

/**
 * Remove all rounds whose lastStatus is "Settled" or "Voided".
 * Returns the number of entries removed.
 */
export function pruneCompleted(storePath: string): number {
  const queue = loadQueue(storePath);
  const before = queue.rounds.length;
  queue.rounds = queue.rounds.filter(
    (r) => r.lastStatus !== "Settled" && r.lastStatus !== "Voided",
  );
  const removed = before - queue.rounds.length;
  if (removed > 0) saveQueue(storePath, queue);
  return removed;
}
