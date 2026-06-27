// Persisted multi-round keeper queue.
// Survives restarts and tracks multiple rounds without relying on process
// memory or manual reruns. Uses a JSON file as the backing store.

import fs from "fs";
import path from "path";

export interface QueueEntry {
  roundId: string;
  addedAt: string;
  status: "pending" | "processing" | "settled" | "failed";
  attempts: number;
  lastAttempt?: string;
  error?: string;
}

export interface KeeperQueue {
  entries: QueueEntry[];
  updatedAt: string;
}

const DEFAULT_QUEUE_PATH = path.resolve("keeper-queue.json");

/** Load the persisted queue from disk. Creates an empty queue if file does not exist. */
export function loadQueue(filePath = DEFAULT_QUEUE_PATH): KeeperQueue {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}

/** Persist the queue to disk atomically via a temp file + rename. */
export function saveQueue(queue: KeeperQueue, filePath = DEFAULT_QUEUE_PATH): void {
  queue.updatedAt = new Date().toISOString();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, filePath);
}

/** Add a round to the queue if not already present. */
export function enqueue(roundId: string, filePath = DEFAULT_QUEUE_PATH): QueueEntry {
  const queue = loadQueue(filePath);
  const existing = queue.entries.find(e => e.roundId === roundId);
  if (existing) return existing;
  const entry: QueueEntry = {
    roundId,
    addedAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  queue.entries.push(entry);
  saveQueue(queue, filePath);
  return entry;
}

/** Update status of a queue entry. */
export function updateEntry(
  roundId: string,
  updates: Partial<Pick<QueueEntry, "status" | "error">>,
  filePath = DEFAULT_QUEUE_PATH,
): void {
  const queue = loadQueue(filePath);
  const entry = queue.entries.find(e => e.roundId === roundId);
  if (!entry) throw new Error(`Queue entry not found: ${roundId}`);
  Object.assign(entry, updates, {
    attempts: entry.attempts + 1,
    lastAttempt: new Date().toISOString(),
  });
  saveQueue(queue, filePath);
}

/** Return all pending entries sorted by addedAt ascending. */
export function getPending(filePath = DEFAULT_QUEUE_PATH): QueueEntry[] {
  const queue = loadQueue(filePath);
  return queue.entries
    .filter(e => e.status === "pending")
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}
