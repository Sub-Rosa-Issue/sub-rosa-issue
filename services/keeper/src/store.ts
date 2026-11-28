import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, type Logger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.store");
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { systemClock, type Clock } from "@sub-rosa/time";

export interface WatchedRound {
  roundId: string;
  contractId?: string;
  network?: string;
  revealRound?: string;
  lastStatus: string;
  phase?: KeeperDryRunPhase;
  cursor?: number | string;
  lastHash?: string;
  retryCount: number;
  lastError?: string;
  lastAction?: string;
  queueStatus?: "queued" | "in-flight" | "terminal";
}

/**
 * Exclusive right to reveal/settle one round, held by exactly one watcher
 * process until it finishes the step or the lease expires. Persisted with the
 * queue so a second process sees it before it schedules the same round.
 */
export interface RoundLease {
  /** Unique id of the watcher process that owns the lease. */
  owner: string;
  roundId: string;
  network?: string;
  contractId?: string;
  /** Epoch ms at which the lease stops being live (exclusive upper bound). */
  expiresAtMs: number;
}

export interface StoreData {
  rounds: Record<string, WatchedRound>;
  leases: Record<string, RoundLease>;
}

/** Scope a lease is granted for: one contract deployment on one network. */
export interface LeaseScope {
  contractId?: string;
  network?: string;
}

export interface ClaimLeaseOptions extends LeaseScope {
  /** Identifier of the claiming watcher; must be unique per process. */
  owner: string;
  /** Lease duration in ms. Defaults to {@link DEFAULT_LEASE_MS}. */
  leaseMs?: number;
}

export type ClaimLeaseResult =
  | { claimed: true; lease: RoundLease }
  | { claimed: false; lease: RoundLease };

/**
 * Default lease duration. Long enough for one slow tick (poll + simulation +
 * submission), short enough that a crashed owner stops blocking the round
 * within a couple of polling cycles.
 */
export const DEFAULT_LEASE_MS = 120_000;

export type RoundIdInput = bigint | number | string;

/** Fresh owner id for a watcher process. */
export function generateLeaseOwner(): string {
  return `keeper-${process.pid}-${randomUUID()}`;
}

/** Parse `KEEPER_LEASE_MS`; empty/absent means "use the default". */
export function parseLeaseMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`KEEPER_LEASE_MS must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function leaseKey(scope: LeaseScope, roundId: string): string {
  return `${scope.contractId ?? "*"}|${scope.network ?? "*"}|${roundId}`;
}

/**
 * Two scopes overlap when they cannot be told apart: an absent contract id or
 * network matches anything, so a lease recorded without scope information
 * still blocks every claim for that round.
 */
function scopesOverlap(a: LeaseScope, b: LeaseScope): boolean {
  const contractOverlap =
    a.contractId === undefined ||
    b.contractId === undefined ||
    a.contractId === b.contractId;
  const networkOverlap =
    a.network === undefined || b.network === undefined || a.network === b.network;
  return contractOverlap && networkOverlap;
}

function normalizeLease(raw: unknown, key: string, logger: Logger): RoundLease | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    logger.warn("store-dropping-malformed-stored-lease", `[Store] Dropping malformed stored lease ${key}: expected an object`);
    return undefined;
  }
  const candidate = raw as Partial<RoundLease>;
  if (typeof candidate.owner !== "string" || !candidate.owner.trim()) {
    logger.warn("store-dropping-malformed-stored-lease-2", `[Store] Dropping malformed stored lease ${key}: missing owner`);
    return undefined;
  }
  if (typeof candidate.expiresAtMs !== "number" || !Number.isFinite(candidate.expiresAtMs)) {
    logger.warn("store-dropping-malformed-stored-lease-3", `[Store] Dropping malformed stored lease ${key}: missing expiry`);
    return undefined;
  }
  let roundId: string;
  try {
    roundId = normalizeRoundId(candidate.roundId ?? key);
  } catch {
    logger.warn("store-dropping-malformed-stored-lease-4", `[Store] Dropping malformed stored lease ${key}: invalid round id`);
    return undefined;
  }
  return {
    owner: candidate.owner,
    roundId,
    network: typeof candidate.network === "string" ? candidate.network : undefined,
    contractId: typeof candidate.contractId === "string" ? candidate.contractId : undefined,
    expiresAtMs: candidate.expiresAtMs,
  };
}

/**
 * Numeric round-id comparator. Orders two round ids by their numeric value
 * regardless of the input type (bigint, number, or string). Returns a negative
 * number if `a < b`, zero if equal, and a positive number if `a > b`.
 */
export function compareRoundIds(a: RoundIdInput, b: RoundIdInput): number {
  const aBig = BigInt(normalizeRoundId(a));
  const bBig = BigInt(normalizeRoundId(b));
  return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
}

export function normalizeRoundId(roundId: RoundIdInput): string {
  let value: bigint;

  if (typeof roundId === "bigint") {
    value = roundId;
  } else if (typeof roundId === "number") {
    if (!Number.isSafeInteger(roundId)) {
      throw new Error(`roundId must be a positive integer, got ${roundId}`);
    }
    value = BigInt(roundId);
  } else {
    const trimmed = roundId.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`roundId must be a positive integer, got ${JSON.stringify(roundId)}`);
    }
    value = BigInt(trimmed);
  }

  if (value <= 0n) {
    throw new Error(`roundId must be a positive integer, got ${value}`);
  }

  return value.toString();
}

let writeSequence = 0;

export class KeeperStore {
  private readonly storePath: string;
  private data: StoreData;

  constructor(
    storePath?: string,
    private readonly logger: Logger = diagnostics,
    private readonly clock: Clock = systemClock,
  ) {
    this.storePath =
      storePath || process.env.KEEPER_STORE_PATH || ".keeper-store.json";
    this.data = this.loadStore();
  }

  private loadStore(): StoreData {
    if (!fs.existsSync(this.storePath)) {
      return { rounds: {}, leases: {} };
    }

    try {
      const content = fs.readFileSync(this.storePath, "utf-8");
      if (!content.trim()) return { rounds: {}, leases: {} };
      const parsed = JSON.parse(content) as Partial<StoreData>;
      if (!parsed.rounds || typeof parsed.rounds !== "object") {
        return { rounds: {}, leases: {} };
      }
      const rounds: Record<string, WatchedRound> = {};
      for (const [key, value] of Object.entries(parsed.rounds)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          this.logger.warn("store-dropping-malformed-stored-round-entry", `[Store] Dropping malformed stored round entry ${key}: expected an object`);
          continue;
        }
        const stored = value as Partial<WatchedRound>;
        let id: string;
        try {
          id = normalizeRoundId(stored.roundId ?? key);
        } catch {
          this.logger.warn("store-dropping-malformed-stored-round-entry-2", `[Store] Dropping malformed stored round entry ${key}: non-numeric or invalid round id ${JSON.stringify(stored.roundId ?? key)}`);
          continue;
        }
        rounds[id] = { ...stored, roundId: id } as WatchedRound;
      }
      const leases: Record<string, RoundLease> = {};
      const storedLeases = parsed.leases;
      if (storedLeases && typeof storedLeases === "object" && !Array.isArray(storedLeases)) {
        for (const [key, value] of Object.entries(storedLeases)) {
          const lease = normalizeLease(value, key, this.logger);
          if (!lease) continue;
          leases[leaseKey(lease, lease.roundId)] = lease;
        }
      }
      return { rounds, leases };
    } catch (e) {
      this.logger.warn("store-failed-to-parse", `[Store] Failed to parse ${this.storePath}. Backing up corrupted file and starting fresh.`);
      try {
        fs.renameSync(this.storePath, `${this.storePath}.corrupted.${this.clock.nowMs()}`);
      } catch (backupErr) {
        this.logger.error("store-could-not-backup-corrupted-file", `[Store] Could not backup corrupted file:`, { "backupErr_0": normalizeError(backupErr) });
      }
      return { rounds: {}, leases: {} };
    }
  }

  private saveStore(): void {
    try {
      // Ensure directory exists if path has one
      const dir = path.dirname(this.storePath);
      if (dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write-then-rename so a second keeper process never reads a half-written
      // store while it is deciding whether it may claim a round.
      const tmpPath = `${this.storePath}.tmp.${process.pid}.${++writeSequence}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.storePath);
    } catch (e) {
      this.logger.error("store-failed-to-save-store-to", `[Store] Failed to save store to ${this.storePath}:`, { "e_0": normalizeError(e) });
    }
  }

  /**
   * Re-read the store from disk. Every mutation persists immediately, so this
   * only picks up what another keeper process wrote since we last loaded.
   * Mutators re-read before writing so a lease claimed elsewhere is merged
   * forward instead of being overwritten by a stale copy.
   */
  private reload(): void {
    this.data = this.loadStore();
  }

  public addRound(roundId: RoundIdInput, extra: Partial<WatchedRound> = {}): void {
    const idStr = normalizeRoundId(roundId);
    this.reload();
    if (!this.data.rounds[idStr]) {
      this.data.rounds[idStr] = {
        lastStatus: "Unknown",
        retryCount: 0,
        ...extra,
        roundId: idStr,
      };
    } else {
      // If it exists, we can optionally update its fields
      this.data.rounds[idStr] = {
        ...this.data.rounds[idStr],
        ...extra,
        roundId: idStr,
      };
    }
    this.saveStore();
  }

  public removeRound(roundId: RoundIdInput): void {
    const idStr = normalizeRoundId(roundId);
    this.reload();
    if (this.data.rounds[idStr]) {
      delete this.data.rounds[idStr];
      this.saveStore();
    }
  }

  public updateRound(roundId: RoundIdInput, update: Partial<WatchedRound>): void {
    const idStr = normalizeRoundId(roundId);
    this.reload();
    if (this.data.rounds[idStr]) {
      this.data.rounds[idStr] = { ...this.data.rounds[idStr], ...update, roundId: idStr };
      this.saveStore();
    }
  }

  public getRound(roundId: RoundIdInput): WatchedRound | undefined {
    return this.data.rounds[normalizeRoundId(roundId)];
  }

  public listRounds(): WatchedRound[] {
    // Return sorted by roundId numerically, regardless of id type
    return Object.values(this.data.rounds).sort((a, b) => compareRoundIds(a.roundId, b.roundId));
  }

  /**
   * Take the exclusive lease on a round.
   *
   * The store is re-read first so a lease written by another process is
   * visible; the check and the write then run back-to-back with no `await`
   * between them. Refuses while a live lease for the same round scope is held
   * by a different owner. The same owner claiming again renews its lease.
   */
  public claimRound(
    roundId: RoundIdInput,
    options: ClaimLeaseOptions,
  ): ClaimLeaseResult {
    const idStr = normalizeRoundId(roundId);
    const owner = options.owner?.trim() ?? "";
    if (!owner) {
      throw new Error("lease owner must be a non-empty string");
    }
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new Error(`leaseMs must be a positive number, got ${leaseMs}`);
    }

    this.reload();
    const now = this.clock.nowMs();
    const scope: LeaseScope = {
      contractId: options.contractId,
      network: options.network,
    };
    const held = Object.values(this.data.leases).find(
      (lease) =>
        lease.roundId === idStr &&
        lease.owner !== owner &&
        lease.expiresAtMs > now &&
        scopesOverlap(lease, scope),
    );
    if (held) {
      this.logger.warn(
        "store-round-lease-held",
        `[Store] Round ${idStr} is leased by ${held.owner} until ${held.expiresAtMs}`,
      );
      return { claimed: false, lease: held };
    }

    const lease: RoundLease = {
      owner,
      roundId: idStr,
      network: options.network,
      contractId: options.contractId,
      expiresAtMs: now + leaseMs,
    };
    this.data.leases[leaseKey(scope, idStr)] = lease;
    this.saveStore();
    return { claimed: true, lease };
  }

  /**
   * Hand the round back. Only the owner's leases are removed, so a watcher can
   * never release a round somebody else is working on.
   */
  public releaseLease(
    roundId: RoundIdInput,
    scope: LeaseScope & { owner: string },
  ): boolean {
    const idStr = normalizeRoundId(roundId);
    const owner = scope.owner?.trim() ?? "";
    if (!owner) {
      throw new Error("lease owner must be a non-empty string");
    }
    this.reload();
    const released = Object.entries(this.data.leases).filter(
      ([, lease]) =>
        lease.roundId === idStr &&
        lease.owner === owner &&
        scopesOverlap(lease, scope),
    );
    if (released.length === 0) return false;
    for (const [key] of released) {
      delete this.data.leases[key];
    }
    this.saveStore();
    return true;
  }

  /**
   * Stored lease for a round, expired or not — callers decide liveness with
   * the clock they injected.
   */
  public getLease(roundId: RoundIdInput, scope: LeaseScope = {}): RoundLease | undefined {
    const idStr = normalizeRoundId(roundId);
    const exact = this.data.leases[leaseKey(scope, idStr)];
    if (exact) return exact;
    return Object.values(this.data.leases).find(
      (lease) => lease.roundId === idStr && scopesOverlap(lease, scope),
    );
  }

  public listLeases(): RoundLease[] {
    return Object.values(this.data.leases).sort(
      (a, b) => compareRoundIds(a.roundId, b.roundId) || a.owner.localeCompare(b.owner),
    );
  }

  public getRawData(): StoreData {
    return this.data;
  }
}
