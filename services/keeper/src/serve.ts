// Standalone status server for the keeper.

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { createSettlementGuard } from "./settlement-guard.js";
import { createStatusServer, withGracefulShutdown } from "./status-server.js";
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
  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    publicKey: Keypair.fromSecret(keeperSecret).publicKey(),
  });
  const drand = quicknet();
  const log = (m: string) => console.log(`· ${m}`);

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();

  const statusEnabled = (process.env.KEEPER_STATUS_ENABLE ?? "true").toLowerCase() !== "false";
  const statusHost = process.env.KEEPER_STATUS_HOST ?? "127.0.0.1";
  const statusPort = Number(process.env.KEEPER_STATUS_PORT ?? "8090");

  let statusHandle: ReturnType<typeof withGracefulShutdown> | undefined;
  if (statusEnabled) {
    const server = createStatusServer({
      host: statusHost,
      port: statusPort,
      contractId,
      network: networkPassphrase,
      reader,
      drand,
      storeRounds: () => store.listRounds(),
      settleIndicator: (rid) => {
        const entry = settlementGuard.getEntry(rid);
        if (!entry) return "none";
        if (entry.status === "pending") return "pending";
        if (entry.status === "submitted") return "submitted";
        return "terminal";
      },
    });
    statusHandle = withGracefulShutdown(server);
    console.log(`· status API: http://${statusHost}:${statusPort}`);
  }

  console.log("Sub Rosa keeper (watch + status)");
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

  if (statusHandle) await statusHandle.close();
  if (shutdownTimer) clearTimeout(shutdownTimer);
  console.log(JSON.stringify({ event: "shutdown_complete", message: "serve stopped gracefully" }));
}

main().catch((err) => {
  console.error("keeper serve failed:", err);
  process.exit(1);
});
