import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.run");
// Keeper CLI entry. Runs one full pass over a round (wait for R → open → reveal
// all) and prints the result. Re-running is safe: completed work is skipped.
//
// Env:
//   ROUND_CONTRACT_ID      deployed Round contract id (C…)
//   ROUND_ID               round to keep (default 1)
//   KEEPER_DRY_RUN         true prints a read-only preflight summary and exits
//   KEEPER_SECRET          funded signer secret (S…); not required for dry-run
//   MAX_WAIT_SECONDS       how long to wait for round R (default 0)
//   RPC_URL                default https://soroban-testnet.stellar.org
//   NETWORK_PASSPHRASE     default testnet
//   KEEPER_CHECKPOINT_PATH default .keeper-checkpoint.json

import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import {
  DEFAULT_CHECKPOINT_PATH,
  KeeperCheckpointStore,
  readCheckpointFile,
} from "./checkpoint.js";
import {
  buildKeeperDryRunSummary,
  parseKeeperRunConfig,
} from "./dry-run.js";
import { keepRound } from "./keeper.js";
import { FileSubmissionJournal } from "./submission-journal.js";

async function main() {
  const config = parseKeeperRunConfig();

  if (config.dryRun) {
    const reader = new SubRosaClient({
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      contractId: config.contractId,
    });
    // Dry run reads the checkpoint for context but never writes it and never
    // builds a transaction.
    const checkpointPath =
      process.env.KEEPER_CHECKPOINT_PATH ?? DEFAULT_CHECKPOINT_PATH;
    const summary = await buildKeeperDryRunSummary(
      reader,
      config.roundId,
      undefined,
      {
        checkpointPath,
        network: config.networkPassphrase,
        contractId: config.contractId,
        currentCheckpoint: readCheckpointFile(checkpointPath),
      },
    );
    diagnostics.info("keeper-dry-run-summary", "keeper dry-run summary:");
    diagnostics.info("progress", JSON.stringify(summary, bigintReplacer, 2));
    if (summary.checkpoint.mismatch) {
      diagnostics.warn(
        "keeper-dry-run-checkpoint-mismatch",
        `dry-run: a live keeper would refuse to start — checkpoint ${summary.checkpoint.mismatch} does not match this process config.`,
      );
    }
    return;
  }

  // Throws KeeperCheckpointMismatchError when the on-disk cursor was recorded
  // for another network or contract — better to stop than to replay it.
  const checkpoint = new KeeperCheckpointStore({
    network: config.networkPassphrase,
    contractId: config.contractId,
  });
  const submissionJournal = new FileSubmissionJournal({
    network: config.networkPassphrase,
    contractId: config.contractId,
  });
  const sdk = new SubRosaClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.contractId,
    secretKey: config.keeperSecret!,
    submissionJournal,
  });

  const result = await keepRound(
    {
      sdk,
      drand: quicknet(),
      log: (m) => diagnostics.info("progress-2", `· ${m}`),
      maxWaitSeconds: config.maxWaitSeconds,
      checkpoint,
    },
    config.roundId,
  );

  diagnostics.info("keeper-result", "\nkeeper result:", { "value1_0": JSON.stringify(result, bigintReplacer, 2) });
  if (result.finalStatus === "Open") {
    diagnostics.info("round-still-open-r-not-yet-published-re-run-later", "round still Open (R not yet published) — re-run later.");
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((err) => {
  diagnostics.error("keeper-failed", "keeper failed:", { "err_0": normalizeError(err) });
  process.exit(1);
});
