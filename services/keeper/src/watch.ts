// Watch-mode keeper — standalone entry. For a combined status-API + watch
// process, use `serve.ts` instead.

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { createSettlementGuard } from "./settlement-guard.js";
import { KeeperStore } from "./store.js";
import { runWatchLoop } from "./watch-loop.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
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
  const drand = quicknet();
  const log = (m: string) => console.log(`· ${m}`);

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();

  console.log("Sub Rosa watch-mode keeper");
  console.log("· contract:", contractId);
  console.log("· poll:    ", pollMs, "ms");
  console.log("· Ctrl+C to stop\n");

  let stopping = false;
  let shutdownTimer: NodeJS.Timeout | undefined;

  const handleSignal = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: "shutdown_start", signal, message: "finishing current tick then exit" }));
    shutdownTimer = setTimeout(() => {
      console.error(JSON.stringify({ event: "shutdown_timeout", message: "timeout exceeded, forcing exit" }));
      process.exit(1);
    }, 30000);
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  await runWatchLoop({
    sdk,
    drand,
    log,
    pollMs,
    contractId,
    network: networkPassphrase,
    store,
    settlementGuard,
    isStopping: () => stopping,
  });

  if (shutdownTimer) clearTimeout(shutdownTimer);
  console.log(JSON.stringify({ event: "shutdown_complete", message: "watch stopped gracefully" }));
}

main().catch((err) => {
  console.error("watch keeper failed:", err);
  process.exit(1);
});
