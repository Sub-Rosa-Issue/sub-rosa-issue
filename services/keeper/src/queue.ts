import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.queue");
import {
  KeeperStore,
  normalizeRoundId,
  compareRoundIds,
  type RoundIdInput,
  type WatchedRound,
} from "./store.js";

export { normalizeRoundId, type RoundIdInput, type WatchedRound };

export interface KeeperQueueOptions {
  contractId?: string;
  network?: string;
}

/**
 * KeeperQueue manages the active pipeline of rounds for the watch loop,
 * ensuring strict state separation between queued and in-flight rounds,
 * and reliable persistence handoff during shutdown and restart.
 */
export class KeeperQueue {
  private readonly store: KeeperStore;
  private readonly options: KeeperQueueOptions;
  private queuedRoundIds: Set<string> = new Set();
  private inFlightRoundIds: Set<string> = new Set();
  private stopping = false;

  constructor(store: KeeperStore, options: KeeperQueueOptions = {}) {
    this.store = store;
    this.options = options;
    this.syncWithStore();
  }

  public syncWithStore(): void {
    const rounds = this.store.listRounds();
    for (const r of rounds) {
      if (this.options.contractId && r.contractId && r.contractId !== this.options.contractId) continue;
      if (this.options.network && r.network && r.network !== this.options.network) continue;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") continue;
      // Do not re-queue a round that is currently in-flight
      if (!this.inFlightRoundIds.has(r.roundId)) {
        this.queuedRoundIds.add(r.roundId);
      }
    }
  }

  public enqueue(roundId: RoundIdInput, extra: Partial<WatchedRound> = {}): WatchedRound {
    const id = normalizeRoundId(roundId);
    this.store.addRound(id, {
      ...extra,
      queueStatus: this.inFlightRoundIds.has(id) ? "in-flight" : "queued",
    });
    const round = this.store.getRound(id)!;
    if (round.lastStatus !== "Settled" && round.lastStatus !== "Voided") {
      if (!this.inFlightRoundIds.has(id)) {
        this.queuedRoundIds.add(id);
      }
    }
    return round;
  }

  public claim(): WatchedRound | undefined {
    if (this.stopping) return undefined;
    for (const id of this.queuedRoundIds) {
      this.queuedRoundIds.delete(id);
      this.inFlightRoundIds.add(id);
      this.store.updateRound(id, { queueStatus: "in-flight" });
      return this.store.getRound(id);
    }
    return undefined;
  }

  public complete(roundId: RoundIdInput, update: Partial<WatchedRound> = {}): void {
    const id = normalizeRoundId(roundId);
    this.inFlightRoundIds.delete(id);
    const isTerminal = update.lastStatus === "Settled" || update.lastStatus === "Voided";
    this.store.updateRound(id, {
      ...update,
      queueStatus: isTerminal ? "terminal" : (this.stopping ? undefined : "queued"),
    });
    const round = this.store.getRound(id);
    if (round && !isTerminal) {
      if (!this.stopping) {
        this.queuedRoundIds.add(id);
      }
    }
  }

  public release(roundId: RoundIdInput, update: Partial<WatchedRound> = {}): void {
    const id = normalizeRoundId(roundId);
    this.inFlightRoundIds.delete(id);
    const isTerminal = update.lastStatus === "Settled" || update.lastStatus === "Voided";
    this.store.updateRound(id, {
      ...update,
      queueStatus: isTerminal ? "terminal" : "queued",
    });
    const round = this.store.getRound(id);
    if (round && !isTerminal) {
      this.queuedRoundIds.add(id);
    }
  }

  public isQueued(roundId: RoundIdInput): boolean {
    return this.queuedRoundIds.has(normalizeRoundId(roundId));
  }

  public isInFlight(roundId: RoundIdInput): boolean {
    return this.inFlightRoundIds.has(normalizeRoundId(roundId));
  }

  public getQueuedRounds(): WatchedRound[] {
    return [...this.queuedRoundIds]
      .map((id) => this.store.getRound(id))
      .filter((r): r is WatchedRound => r !== undefined)
      .sort((a, b) => compareRoundIds(a.roundId, b.roundId));
  }

  public getInFlightRounds(): WatchedRound[] {
    return [...this.inFlightRoundIds]
      .map((id) => this.store.getRound(id))
      .filter((r): r is WatchedRound => r !== undefined)
      .sort((a, b) => compareRoundIds(a.roundId, b.roundId));
  }

  public stop(): void {
    this.stopping = true;
  }

  public isStopping(): boolean {
    return this.stopping;
  }

  public size(): number {
    return this.queuedRoundIds.size;
  }

  public inFlightCount(): number {
    return this.inFlightRoundIds.size;
  }
}

function usage() {
  diagnostics.info("usage-npm-run-queue-command-args-commands-add-roundid-a", `
Usage: npm run queue <command> [args]

Commands:
  add <roundId>      Add a round to the watched queue
  list               List all watched rounds and their status
  remove <roundId>   Remove a round from the queue
  claim <roundId>    Take the exclusive lease on a round (owner: KEEPER_OWNER)
  release <roundId>  Give back a lease this owner holds on a round
`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
  }

  const cmd = args[0];
  const store = new KeeperStore();
  const contractId = process.env.ROUND_CONTRACT_ID;
  const network = process.env.NETWORK_PASSPHRASE;
  const owner = process.env.KEEPER_OWNER?.trim() || `queue-cli-${process.pid}`;

  if (cmd === "add") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    const contractId = process.env.ROUND_CONTRACT_ID;
    const network = process.env.NETWORK_PASSPHRASE;
    const queue = new KeeperQueue(store, { contractId, network });
    queue.enqueue(roundId, { contractId, network });
    diagnostics.info("added-round", `Added round ${roundId} to the queue.`);
  } else if (cmd === "list") {
    const rounds = store.listRounds();
    if (rounds.length === 0) {
      diagnostics.info("queue-is-empty", "Queue is empty.");
      return;
    }
    diagnostics.info("watching", `Watching ${rounds.length} rounds:\n`);
    for (const r of rounds) {
      const extra = r.lastAction ? ` (action: ${r.lastAction})` : "";
      const err = r.lastError ? ` (error: ${r.lastError})` : "";
      const contract = r.contractId ? ` [${r.contractId}]` : "";
      const lease = store.getLease(r.roundId);
      const leased = lease ? ` [lease: ${lease.owner} until ${lease.expiresAtMs}]` : "";
      diagnostics.info("round", `- Round ${r.roundId}${contract}: ${r.lastStatus}${extra}${err} [retries: ${r.retryCount}]${leased}`);
    }
  } else if (cmd === "remove") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid-2", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    store.removeRound(roundId);
    diagnostics.info("removed-round", `Removed round ${roundId} from the queue.`);
  } else if (cmd === "claim") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid-3", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    const leaseMs = parseLeaseMs(process.env.KEEPER_LEASE_MS);
    const claim = store.claimRound(roundId, {
      owner,
      contractId,
      network,
      ...(leaseMs !== undefined ? { leaseMs } : {}),
    });
    if (claim.claimed) {
      diagnostics.info("claimed-round-lease", `Claimed round ${roundId} as ${owner} until ${claim.lease.expiresAtMs}.`);
    } else {
      diagnostics.error(
        "round-lease-held",
        `Round ${roundId} is leased by ${claim.lease.owner} until ${claim.lease.expiresAtMs}.`,
      );
      process.exitCode = 1;
    }
  } else if (cmd === "release") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid-4", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    if (store.releaseLease(roundId, { owner, contractId, network })) {
      diagnostics.info("released-round-lease", `Released the ${roundId} lease held by ${owner}.`);
    } else {
      diagnostics.error("round-lease-not-owned", `Round ${roundId} has no lease held by ${owner}.`);
      process.exitCode = 1;
    }
  } else {
    diagnostics.error("unknown-command", `Unknown command: ${cmd}`);
    usage();
  }
}

const isCli =
  typeof process !== "undefined" &&
  Boolean(
    process.argv[1] &&
      (process.argv[1].endsWith("queue.ts") ||
        process.argv[1].endsWith("queue.js") ||
        process.argv[1].endsWith("queue")),
  );

if (isCli) {
  try {
    main();
  } catch (error) {
    diagnostics.error("error", `Error: ${normalizeError(error).message}`);
    process.exit(1);
  }
}
