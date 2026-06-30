// Optional mainnet micro commit on an EXISTING deployed Round contract.
//
// Default: checklist + dry-run only — no transactions.
// Execute: requires MAINNET_CONFIRM=SUB_ROSA_MAINNET and explicit --execute.
// Amounts are capped well below testnet demo sizes (never 700 USDC-scale).

import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

import { SubRosaClient } from "../src/client.js";
import {
  MAINNET_ARTIFACTS,
  MAINNET_MICRO_MAX_ESCROW,
} from "../src/mainnet-artifacts.js";
import {
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  defaultMainnetReadinessInput,
  runMainnetReadiness,
} from "../src/mainnet-readiness.js";
import { generateAuditorKeypair, generateNonce, quicknet, sealBid } from "@sub-rosa/tlock";

const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;

const DEFAULT_BID = 500_000n; // 0.05 XLM
const DEFAULT_ESCROW = 1_000_000n; // 0.1 XLM

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function parseStroops(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = BigInt(raw);
  if (v <= 0n) throw new Error(`${name} must be positive`);
  if (v > MAINNET_MICRO_MAX_ESCROW) {
    throw new Error(`${name}=${v} exceeds MAINNET_MICRO_MAX_ESCROW (${MAINNET_MICRO_MAX_ESCROW})`);
  }
  return v;
}

function printChecklist(bid: bigint, escrow: bigint, execute: boolean) {
  console.log("Sub Rosa — mainnet micro runner\n");
  console.log("Contract (existing):", process.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId);
  console.log("Token:               native XLM SAC");
  console.log("Bid (stroops):      ", bid.toString(), `(${(Number(bid) / 1e7).toFixed(7)} XLM)`);
  console.log("Escrow (stroops):   ", escrow.toString(), `(${(Number(escrow) / 1e7).toFixed(7)} XLM)`);
  console.log("");
  console.log("Checklist:");
  console.log("  [ ] ROUND_CONTRACT_ID points at deployed mainnet Round");
  console.log("  [ ] OPERATOR_SECRET + BIDDER_SECRET funded with XLM for fees");
  console.log("  [ ] Amounts are micro (never testnet 700/459 USDC demo sizes)");
  console.log("  [ ] Round 1 settled proof already verified via pnpm mainnet:verify");
  if (execute) {
    console.log("  [ ] MAINNET_CONFIRM=SUB_ROSA_MAINNET is set");
    console.log("  [ ] --execute flag passed");
  } else {
    console.log("  [ ] Dry-run only — no transactions will be sent");
  }
  console.log("");
}

async function main() {
  const execute = process.argv.includes("--execute");
  const bid = parseStroops("MICRO_BID_STROOPS", DEFAULT_BID);
  const escrow = parseStroops("MICRO_ESCROW_STROOPS", DEFAULT_ESCROW);
  assertMicroAmounts(bid, escrow);

  printChecklist(bid, escrow, execute);

  if (!execute) {
    console.log("DRY-RUN complete. To send txs:");
    console.log("  MAINNET_CONFIRM=SUB_ROSA_MAINNET OPERATOR_SECRET=S… BIDDER_SECRET=S… \\");
    console.log("    pnpm mainnet:micro -- --execute");
    return;
  }

  if (process.env.MAINNET_CONFIRM !== "SUB_ROSA_MAINNET") {
    throw new Error('set MAINNET_CONFIRM=SUB_ROSA_MAINNET to execute on mainnet');
  }
  assertMainnetConfirmed();

  const operatorSecret = reqEnv("OPERATOR_SECRET");
  const bidderSecret = reqEnv("BIDDER_SECRET");
  const contractId = process.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId;
  const rpcUrl = process.env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl;
  const network = process.env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase;

  const operatorKp = Keypair.fromSecret(operatorSecret);
  const bidderKp = Keypair.fromSecret(bidderSecret);

  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    publicKey: operatorKp.publicKey(),
  });

  const readiness = await runMainnetReadiness(
    defaultMainnetReadinessInput({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      withBalances: true,
      operatorAccount: operatorKp.publicKey(),
      bidderAccount: bidderKp.publicKey(),
    }),
    { reader },
  );
  assertReadinessForExecute(readiness.checks);

  // Pick next round id: max existing + 1 (probe up to 32).
  let nextRound = 1n;
  for (let id = 1n; id <= 32n; id++) {
    try {
      await reader.getRound(id);
      nextRound = id + 1n;
    } catch {
      break;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const revealRound = Math.ceil((now + 300 - DRAND_GENESIS) / DRAND_PERIOD);
  const commitDeadline = now + 120;
  const revealDeadline = DRAND_GENESIS + DRAND_PERIOD * revealRound + 180;
  const auditor = generateAuditorKeypair();

  console.log(`→ createRound id≈${nextRound} R=${revealRound}…`);
  const operator = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    secretKey: operatorSecret,
  });
  const roundId = await operator.createRound({
    itemRef: randomBytes(32),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });

  const drand = quicknet();
  const nonce = generateNonce();
  const sealed = await sealBid({
    value: bid,
    nonce,
    round: revealRound,
    client: drand,
    identity: new TextEncoder().encode(`micro:${bidderKp.publicKey()}`),
    auditorPublicKey: auditor.publicKey,
  });

  console.log("→ commit micro sealed bid…");
  const bidder = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    secretKey: bidderSecret,
  });
  await bidder.commit({ roundId, sealed, escrow });

  console.log("\n✅ MAINNET MICRO COMMIT SENT");
  console.log("   contract:", contractId);
  console.log("   round:   ", roundId.toString());
  console.log("   R:       ", revealRound);
  console.log("   bid:     ", (Number(bid) / 1e7).toFixed(7), "XLM");
  console.log("   escrow:  ", (Number(escrow) / 1e7).toFixed(7), "XLM");
  console.log("\nNext: wait for R, then pnpm mainnet:settle with ROUND_ID=", roundId.toString());
}

main().catch((err) => {
  console.error("\n❌ MAINNET MICRO FAILED");
  console.error(err);
  process.exit(1);
});
