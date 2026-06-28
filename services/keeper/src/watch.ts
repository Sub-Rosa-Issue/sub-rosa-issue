// Watch-mode keeper — polls the Round contract and drives every in-flight round
// through open → reveal → clear → settle (or void after grace). Permissionless,
// idempotent, no relayer.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   KEEPER_SECRET       funded signer secret (S…)
//   RPC_URL             Soroban RPC (default testnet)
//   NETWORK_PASSPHRASE
//   WATCH_POLL_MS       poll interval (default 15000)
//   WATCH_ROUND_IDS     optional explicit list: "1,2,5" or "1-10"
//   WATCH_FROM          first round id when auto-discovering (default 1)
//   WATCH_MAX_ROUNDS    max rounds to probe (default 64)
//   WATCH_QUEUE_FILE    path to persisted queue store (default keeper-queue.json)
//   WATCH_RESUME_QUEUE  include queued rounds in watch loop (default true)
//
// Queue management flags (print result then exit):
//   --add-round <id>     register a round for watching (requires ROUND_CONTRACT_ID)
//   --list-watched       show all rounds in the queue
//   --remove-round <id>  stop watching a round (requires ROUND_CONTRACT_ID)
//   --prune              remove completed (Settled/Voided) rounds from the queue

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import {
  discoverRoundIds,
  parseRoundIdSpec,
  watchRound,
  type WatchTickResult,
} from "./keeper.js";
import {
  addRound,
  listRounds,
  loadQueue,
  pruneCompleted,
  removeRound,
  updateRound,
  DEFAULT_QUEUE_FILE,
} from "./queue.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

function summarizeTick(t: WatchTickResult): string {
  const parts: string[] = [t.finalStatus];
  if (t.void?.voided) parts.push("voided");
  if (t.keep?.openedReveal) parts.push("opened");
  if (t.keep?.revealed.length) parts.push(`revealed×${t.keep.revealed.length}`);
  if (t.close?.cleared) parts.push("cleared");
  if (t.close?.settled) parts.push("settled");
  return parts.join(", ");
}

function getQueueFile(): string {
  return process.env.WATCH_QUEUE_FILE?.trim() || DEFAULT_QUEUE_FILE;
}

function isResumeEnabled(): boolean {
  const v = process.env.WATCH_RESUME_QUEUE?.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no" && v !== "off";
}

async function resolveRoundIds(reader: SubRosaClient): Promise<bigint[]> {
  const spec = process.env.WATCH_ROUND_IDS?.trim();
  if (spec) return parseRoundIdSpec(spec);
  const single = process.env.ROUND_ID?.trim();
  if (single) return [BigInt(single)];
  return discoverRoundIds(reader, {
    from: BigInt(process.env.WATCH_FROM ?? "1"),
    maxProbe: Number(process.env.WATCH_MAX_ROUNDS ?? "64"),
  });
}

/** Collect queued round IDs for the current contract (resume behavior). */
function queuedRoundIds(contractId: string, queueFile: string): bigint[] {
  const queue = loadQueue(queueFile);
  return queue.rounds
    .filter(
      (r) =>
        r.contractId === contractId &&
        r.lastStatus !== "Settled" &&
        r.lastStatus !== "Voided",
    )
    .map((r) => BigInt(r.roundId));
}

/** Merge two lists of round IDs, deduplicating and preserving sort order. */
function mergeRoundIds(a: bigint[], b: bigint[]): bigint[] {
  const seen = new Set<string>();
  const merged: bigint[] = [];
  for (const id of [...a, ...b]) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(id);
    }
  }
  return merged.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

// ── CLI management commands ────────────────────────────────────────────────

function cmdListWatched(queueFile: string): void {
  const rounds = listRounds(queueFile);
  if (rounds.length === 0) {
    console.log("queue: no rounds registered");
    return;
  }
  console.log(`queue file: ${queueFile}`);
  console.log(`watched rounds (${rounds.length}):`);
  for (const r of rounds) {
    const retry = r.retryCount > 0 ? ` retries=${r.retryCount}` : "";
    const action = r.lastAction ? ` lastAction=${r.lastAction}` : "";
    console.log(
      `  round=${r.roundId}  contract=${r.contractId}  network=${r.network}` +
        `  status=${r.lastStatus}  revealRound=${r.revealRound}${action}${retry}` +
        `  added=${r.createdAt}`,
    );
  }
}

function cmdAddRound(roundId: bigint, queueFile: string): void {
  const contractId = reqEnv("ROUND_CONTRACT_ID");
  const network =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const { entry, added } = addRound(queueFile, { roundId, contractId, network });
  if (added) {
    console.log(
      `queue: added round ${roundId} for contract ${contractId} (file: ${queueFile})`,
    );
  } else {
    console.log(
      `queue: round ${roundId} for contract ${contractId} is already registered (status: ${entry.lastStatus})`,
    );
  }
}

function cmdRemoveRound(roundId: bigint, queueFile: string): void {
  const contractId = reqEnv("ROUND_CONTRACT_ID");
  const removed = removeRound(queueFile, roundId, contractId);
  if (removed) {
    console.log(`queue: removed round ${roundId} from contract ${contractId}`);
  } else {
    console.log(
      `queue: round ${roundId} for contract ${contractId} was not found in the queue`,
    );
  }
}

function cmdPrune(queueFile: string): void {
  const count = pruneCompleted(queueFile);
  console.log(
    count > 0
      ? `queue: pruned ${count} completed round(s)`
      : "queue: nothing to prune",
  );
}

// ── Argument parsing ──────────────────────────────────────────────────────

interface ParsedArgs {
  addRound?: bigint;
  removeRound?: bigint;
  listWatched: boolean;
  prune: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { listWatched: false, prune: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--add-round") {
      const next = args[++i];
      if (!next) throw new Error("--add-round requires a round ID argument");
      result.addRound = BigInt(next);
    } else if (arg === "--remove-round") {
      const next = args[++i];
      if (!next) throw new Error("--remove-round requires a round ID argument");
      result.removeRound = BigInt(next);
    } else if (arg === "--list-watched") {
      result.listWatched = true;
    } else if (arg === "--prune") {
      result.prune = true;
    }
  }

  return result;
}

async function main() {
  const queueFile = getQueueFile();
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv);
  } catch (e) {
    console.error("watch:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // ── Management commands (run then exit) ──────────────────────────────
  if (parsed.listWatched) {
    cmdListWatched(queueFile);
    return;
  }
  if (parsed.prune) {
    cmdPrune(queueFile);
    return;
  }
  if (parsed.addRound != null) {
    cmdAddRound(parsed.addRound, queueFile);
    return;
  }
  if (parsed.removeRound != null) {
    cmdRemoveRound(parsed.removeRound, queueFile);
    return;
  }

  // ── Watch loop ────────────────────────────────────────────────────────
  const pollMs = Number(process.env.WATCH_POLL_MS ?? "15000");
  const contractId = reqEnv("ROUND_CONTRACT_ID");

  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const keeperSecret = reqEnv("KEEPER_SECRET");

  const sdk = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    secretKey: keeperSecret,
  });

  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    publicKey: Keypair.fromSecret(keeperSecret).publicKey(),
  });

  const drand = quicknet();
  const log = (m: string) => console.log(`· ${m}`);
  const resumeQueue = isResumeEnabled();

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nwatch: SIGINT — finishing current tick then exit");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  console.log("Sub Rosa watch-mode keeper");
  console.log("· contract:", contractId);
  console.log("· poll:    ", pollMs, "ms");
  console.log("· queue:   ", queueFile, resumeQueue ? "(resume enabled)" : "(resume disabled)");
  console.log("· Ctrl+C to stop\n");

  while (!stopping) {
    const started = Date.now();
    let roundIds: bigint[];
    try {
      const discovered = await resolveRoundIds(reader);
      const queued = resumeQueue
        ? queuedRoundIds(contractId, queueFile)
        : [];
      roundIds = mergeRoundIds(discovered, queued);
    } catch (e) {
      console.error("watch: failed to list rounds:", e);
      await sleep(pollMs);
      continue;
    }

    if (roundIds.length === 0) {
      log("no rounds found — waiting");
    }

    for (const roundId of roundIds) {
      if (stopping) break;
      try {
        const tick = await watchRound({ sdk, drand, log }, roundId);
        const active =
          tick.finalStatus !== "Settled" && tick.finalStatus !== "Voided";
        const acted =
          tick.void?.voided ||
          tick.keep?.openedReveal ||
          (tick.keep?.revealed.length ?? 0) > 0 ||
          tick.close?.cleared ||
          tick.close?.settled;
        if (active || acted) {
          console.log(
            `[round ${roundId}] ${summarizeTick(tick)}`,
            acted ? JSON.stringify(tick, bigintReplacer) : "",
          );
        }

        // Persist the latest status into the queue if this round is tracked.
        updateRound(queueFile, roundId, contractId, {
          lastStatus: tick.finalStatus,
          lastRetryAt: new Date().toISOString(),
          lastAction: acted
            ? (tick.close?.settled
                ? "settle"
                : tick.close?.cleared
                  ? "clear"
                  : tick.keep?.openedReveal
                    ? "open"
                    : (tick.keep?.revealed.length ?? 0) > 0
                      ? "reveal"
                      : tick.void?.voided
                        ? "void"
                        : null)
            : null,
        });
      } catch (e) {
        console.error(`[round ${roundId}] tick failed:`, e);
        // Increment retry counter for tracked rounds.
        const q = loadQueue(queueFile);
        const entry = q.rounds.find(
          (r) => r.roundId === String(roundId) && r.contractId === contractId,
        );
        if (entry) {
          updateRound(queueFile, roundId, contractId, {
            retryCount: entry.retryCount + 1,
            lastRetryAt: new Date().toISOString(),
          });
        }
      }
    }

    const elapsed = Date.now() - started;
    const wait = Math.max(0, pollMs - elapsed);
    if (!stopping && wait > 0) await sleep(wait);
  }

  console.log("watch: stopped");
}

main().catch((err) => {
  console.error("watch keeper failed:", err);
  process.exit(1);
});
