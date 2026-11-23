import { normalizeError } from "@sub-rosa/logging/errors";
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("packages.sdk.scripts.mainnet-ready");
// Consolidated mainnet launch readiness — read-only by default.
//
// Reads the committed artifact manifest and compares the live deployment with
// it. Any disagreement in contract id, network passphrase, wasm hash, or escrow
// token contract blocks, and the report names the field.
//
// Usage:
//   pnpm mainnet:ready
//   pnpm mainnet:ready -- --strict
//   pnpm mainnet:ready -- --fixture packages/sdk/fixtures/mainnet-readiness.json
//   pnpm mainnet:ready -- --with-balances
//
// Never needs a secret key: the client is read-only and every account input is
// a public key.

import { SubRosaClient } from "../src/client.js";
import { MAINNET_CONFIRM_PHRASE } from "../src/mainnet-artifacts.js";
import {
  loadMainnetReadinessFixture,
  loadMainnetManifest,
} from "../src/mainnet-manifest.js";
import {
  defaultMainnetReadinessInput,
  formatReadinessReport,
  runMainnetReadiness,
} from "../src/mainnet-readiness.js";

const DEFAULT_READER_PUBKEY =
  "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Value that follows a flag, or undefined when it was passed bare. */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  return next !== undefined && !next.startsWith("--") ? next : undefined;
}

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.MAINNET_DRY_RUN === "1";
  const withBalances = process.argv.includes("--with-balances");
  const strict = process.argv.includes("--strict");
  // `--fixture` may be bare: replay the committed recording.
  // `--fixture` may be bare, in which case the committed recording is replayed.
  const replayFixture = hasFlag("--fixture");
  const fixturePath = replayFixture ? argValue("--fixture") : undefined;

  // The committed manifest is the source of truth. Env vars may point the run
  // somewhere else, but then the config checks below fail — deliberately.
  const loaded = loadMainnetManifest(hasFlag("--manifest") ? argValue("--manifest") : undefined);
  const manifest = loaded.manifest;
  diagnostics.info("manifest-loaded", "Committed artifact manifest", {
    path: loaded.path,
    sha256: loaded.sha256.slice(0, 12),
    contract: manifest.contractId,
    network: manifest.network,
  });

  const input = defaultMainnetReadinessInput(
    {
      rpcUrl: process.env.RPC_URL ?? manifest.rpcUrl,
      networkPassphrase:
        process.env.NETWORK_PASSPHRASE ?? manifest.networkPassphrase,
      contractId: process.env.ROUND_CONTRACT_ID ?? manifest.contractId,
      manifestSource: loaded.path,
      live: !dryRun,
      withBalances,
      operatorAccount: process.env.OPERATOR_PUBLIC_KEY,
      keeperAccount: process.env.KEEPER_PUBLIC_KEY,
      bidderAccount: process.env.BIDDER_PUBLIC_KEY,
    },
    manifest,
  );

  const fixture = replayFixture
    ? loadMainnetReadinessFixture(fixturePath).fixture
    : undefined;
  if (fixture) {
    diagnostics.info("fixture-mode", "Replaying a recorded deployment", {
      rpc: "none",
      secrets: "none",
    });
  }

  const reader =
    fixture || dryRun
      ? undefined
      : new SubRosaClient({
          rpcUrl: input.rpcUrl,
          networkPassphrase: input.networkPassphrase,
          contractId: input.contractId,
          publicKey: process.env.MAINNET_READER_PUBKEY ?? DEFAULT_READER_PUBKEY,
        });

  const report = await runMainnetReadiness(
    fixture ? { ...input, fixture } : input,
    { reader },
  );
  diagnostics.info("progress", formatReadinessReport(report));

  if (report.blockCount > 0) {
    if (report.deployment && !report.deployment.matched) {
      diagnostics.error(
        "deployment-mismatch",
        `deployment does not match the committed manifest ${loaded.path}`,
        {
          fields: report.deployment.mismatchedFieldNames,
          unreadable: report.deployment.unreadable.map((f) => f.field),
        },
      );
    }
    diagnostics.info(
      "blocking-issues-must-be-resolved-before-mainnet-executi",
      "\nBlocking issues must be resolved before mainnet execution.",
    );
    diagnostics.info(
      "value-moving-commands-require",
      "Value-moving commands require:",
    );
    diagnostics.info("mainnet-confirm", `  MAINNET_CONFIRM=${MAINNET_CONFIRM_PHRASE}`);
    process.exit(1);
  }

  if (strict) {
    diagnostics.info("strict-ok", "Strict readiness: no blocking findings");
  }

  diagnostics.info("mainnet-readiness-ok", "\nMAINNET READINESS OK");
  diagnostics.info("recommended-launch-checklist", "Recommended launch checklist:");
  diagnostics.info("1-pnpm-mainnet-ready-strict", "  1. pnpm mainnet:ready -- --strict");
  diagnostics.info("2-pnpm-mainnet-verify", "  2. pnpm mainnet:verify");
  diagnostics.info("3-pnpm-mainnet-micro-dry-run", "  3. pnpm mainnet:micro            # dry-run");
  diagnostics.info("4-mainnet-confirm-sub-rosa-mainnet-pnpm-mainnet-micro-e", "  4. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:micro -- --execute");
  diagnostics.info("5-mainnet-confirm-sub-rosa-mainnet-pnpm-mainnet-settle", "  5. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:settle");
}

main().catch((err) => {
  diagnostics.error("mainnet-readiness-failed", "\nMAINNET READINESS FAILED");
  diagnostics.error("progress-2", normalizeError(err));
  process.exit(1);
});
