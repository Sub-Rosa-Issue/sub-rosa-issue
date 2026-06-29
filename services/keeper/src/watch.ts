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

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import {
  discoverRoundIds,
  parseRoundIdSpec,
  watchRound,
  type WatchTickResult,
} from "./keeper.js";
import { KeeperStore } from "./store.js";

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

async function main() {
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

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nwatch: SIGINT — finishing current tick then exit");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  const store = new KeeperStore();

  console.log("Sub Rosa watch-mode keeper");
  console.log("· contract:", contractId);
  console.log("· poll:    ", pollMs, "ms");
  console.log("· Ctrl+C to stop\n");

  while (!stopping) {
    const started = Date.now();
    let discoveredIds: bigint[] = [];
    try {
      discoveredIds = await resolveRoundIds(reader);
      // Auto-add newly discovered/requested rounds to store
      for (const id of discoveredIds) {
        store.addRound(id, { contractId, network: networkPassphrase });
      }
    } catch (e) {
      console.error("watch: failed to list/discover rounds:", e);
    }

    const queuedRounds = store.listRounds();
    // Only process rounds that belong to this contract/network and aren't permanently finished
    const activeRounds = queuedRounds.filter((r) => {
      if (r.contractId && r.contractId !== contractId) return false;
      if (r.network && r.network !== networkPassphrase) return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    if (activeRounds.length === 0) {
      log("no active rounds found in queue — waiting");
    }

    for (const storedRound of activeRounds) {
      const roundId = BigInt(storedRound.roundId);
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

        store.updateRound(roundId, {
          lastStatus: tick.finalStatus,
          retryCount: 0,
          lastError: undefined,
          lastAction: acted ? summarizeTick(tick) : storedRound.lastAction,
        });

        if (active || acted) {
          console.log(
            `[round ${roundId}] ${summarizeTick(tick)}`,
            acted ? JSON.stringify(tick, bigintReplacer) : "",
          );
        }
      } catch (e) {
        console.error(`[round ${roundId}] tick failed:`, e);
        store.updateRound(roundId, {
          retryCount: storedRound.retryCount + 1,
          lastError: e instanceof Error ? e.message : String(e),
        });
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
