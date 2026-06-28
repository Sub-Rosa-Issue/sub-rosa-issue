// Keeper CLI entry. Runs one full pass over a round (wait for R → open → reveal
// all) and prints the result. Re-running is safe: completed work is skipped.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   ROUND_ID            round to keep (default 1)
//   KEEPER_DRY_RUN      true prints a read-only preflight summary and exits
//   KEEPER_SECRET       funded signer secret (S…); not required for dry-run
//   MAX_WAIT_SECONDS    how long to wait for round R (default 0)
//   RPC_URL             default https://soroban-testnet.stellar.org
//   NETWORK_PASSPHRASE  default testnet

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import {
  buildKeeperDryRunSummary,
  parseKeeperRunConfig,
  type KeeperDryRunReader,
  type KeeperRunConfig,
} from "./dry-run.js";
import { keepRound } from "./keeper.js";

type CliIo = {
  stdout: Pick<Console, "log">;
  stderr: Pick<Console, "error">;
};

interface KeeperCliDeps {
  createClient: (config: KeeperRunConfig) => unknown;
  buildDryRunSummary: (
    reader: KeeperDryRunReader,
    roundId: bigint,
  ) => Promise<unknown>;
  keepRoundFn?: (
    input: {
      sdk: unknown;
      drand: unknown;
      log: (m: string) => void;
      maxWaitSeconds: number;
    },
    roundId: bigint,
  ) => Promise<unknown>;
}

const defaultDeps: KeeperCliDeps = {
  createClient: (config: KeeperRunConfig) =>
    new SubRosaClient({
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      contractId: config.contractId,
      ...(config.keeperSecret ? { secretKey: config.keeperSecret } : {}),
    }),
  buildDryRunSummary: (reader, roundId) =>
    buildKeeperDryRunSummary(reader, roundId),
};

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function runKeeperCli(
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = { stdout: console, stderr: console },
  deps: KeeperCliDeps = defaultDeps,
): Promise<number> {
  let config: KeeperRunConfig;
  try {
    config = parseKeeperRunConfig(env);
  } catch (err) {
    io.stderr.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    if (config.dryRun) {
      const reader = deps.createClient(config) as KeeperDryRunReader;
      const summary = await deps.buildDryRunSummary(reader, config.roundId);
      io.stdout.log("keeper dry-run summary:");
      io.stdout.log(JSON.stringify(summary, bigintReplacer, 2));
      return 0;
    }

    const sdk = deps.createClient(config);
    const result = await (deps.keepRoundFn ?? ((input, roundId) => keepRound(input as Parameters<typeof keepRound>[0], roundId)))(
      {
        sdk,
        drand: quicknet(),
        log: (m) => io.stdout.log(`· ${m}`),
        maxWaitSeconds: config.maxWaitSeconds,
      },
      config.roundId,
    );

    io.stdout.log("\nkeeper result:", JSON.stringify(result, bigintReplacer, 2));
    if ((result as { finalStatus?: string }).finalStatus === "Open") {
      io.stdout.log("round still Open (R not yet published) — re-run later.");
    }
    return 0;
  } catch (err) {
    io.stderr.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function main() {
  const exitCode = await runKeeperCli();
  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("keeper failed:", err);
    process.exit(1);
  });
}
