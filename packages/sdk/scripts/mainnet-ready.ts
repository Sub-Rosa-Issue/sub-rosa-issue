// Consolidated mainnet launch readiness — read-only by default.
//
// Usage:
//   pnpm mainnet:ready
//   pnpm mainnet:ready -- --dry-run
//   pnpm mainnet:ready -- --with-balances --strict

import { Keypair } from "@stellar/stellar-sdk";

import { SubRosaClient } from "../src/client.js";
import { MAINNET_ARTIFACTS, MAINNET_CONFIRM_PHRASE } from "../src/mainnet-artifacts.js";
import {
  defaultMainnetReadinessInput,
  formatReadinessReport,
  hasBlockingFailures,
  runMainnetReadiness,
} from "../src/mainnet-readiness.js";

const DEFAULT_READER_PUBKEY =
  "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR";

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.MAINNET_DRY_RUN === "1";
  const withBalances = process.argv.includes("--with-balances");
  const strict = process.argv.includes("--strict");

  const rpcUrl = process.env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl;
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase;
  const contractId =
    process.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId;

  const operatorAccount = process.env.OPERATOR_SECRET
    ? Keypair.fromSecret(process.env.OPERATOR_SECRET).publicKey()
    : undefined;
  const keeperAccount = process.env.KEEPER_SECRET
    ? Keypair.fromSecret(process.env.KEEPER_SECRET).publicKey()
    : undefined;
  const bidderAccount = process.env.BIDDER_SECRET
    ? Keypair.fromSecret(process.env.BIDDER_SECRET).publicKey()
    : undefined;

  const input = defaultMainnetReadinessInput({
    rpcUrl,
    networkPassphrase,
    contractId,
    live: !dryRun,
    withBalances,
    operatorAccount,
    keeperAccount,
    bidderAccount,
  });

  const reader = dryRun
    ? undefined
    : new SubRosaClient({
        rpcUrl,
        networkPassphrase,
        contractId,
        publicKey:
          process.env.MAINNET_READER_PUBKEY ?? DEFAULT_READER_PUBKEY,
      });

  const report = await runMainnetReadiness(input, { reader });
  console.log(formatReadinessReport(report));

  if (strict && hasBlockingFailures(report.checks)) {
    throw new Error("readiness checks failed in strict mode");
  }

  if (report.blockCount > 0) {
    console.log("\nBlocking issues must be resolved before mainnet execution.");
    console.log("Value-moving commands require:");
    console.log(`  MAINNET_CONFIRM=${MAINNET_CONFIRM_PHRASE}`);
    process.exit(1);
  }

  console.log("\n✅ MAINNET READINESS OK");
  console.log("Recommended launch checklist:");
  console.log("  1. pnpm mainnet:ready -- --strict");
  console.log("  2. pnpm mainnet:verify");
  console.log("  3. pnpm mainnet:micro            # dry-run");
  console.log("  4. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:micro -- --execute");
  console.log("  5. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:settle");
}

main().catch((err) => {
  console.error("\n❌ MAINNET READINESS FAILED");
  console.error(err);
  process.exit(1);
});
