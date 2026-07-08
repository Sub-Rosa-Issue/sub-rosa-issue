// Mainnet settlement — keepRound (wait R → open → reveal) + closeRound (clear → settle).
// Env: KEEPER_SECRET, ROUND_CONTRACT_ID, ROUND_ID (default 1)
// Requires MAINNET_CONFIRM=SUB_ROSA_MAINNET before submitting transactions.

import { Keypair } from "@stellar/stellar-sdk";
import {
  assertMainnetConfirmed,
  assertReadinessForExecute,
  createSacBalanceReader,
  defaultMainnetReadinessInput,
  nativeXlmSacId,
  runMainnetReadiness,
  SubRosaClient,
} from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { closeRound, keepRound } from "../src/keeper.js";

const RPC_URL = process.env.RPC_URL ?? "https://rpc.ankr.com/stellar_soroban";
const NETWORK =
  process.env.NETWORK_PASSPHRASE ??
  "Public Global Stellar Network ; September 2015";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

async function main() {
  assertMainnetConfirmed();

  const keeperSecret = reqEnv("KEEPER_SECRET");
  const contractId = reqEnv("ROUND_CONTRACT_ID");
  const roundId = BigInt(process.env.ROUND_ID ?? "1");
  const keeperKp = Keypair.fromSecret(keeperSecret);

  const reader = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    publicKey: keeperKp.publicKey(),
  });

  const readiness = await runMainnetReadiness(
    defaultMainnetReadinessInput({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      contractId,
      withBalances: false,
    }),
    { reader },
  );
  assertReadinessForExecute(readiness.checks);

  const sdk = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    secretKey: keeperSecret,
  });
  const drand = quicknet();
  const log = (m: string) => console.log("    ·", m);

  console.log("· contract:", contractId);
  console.log("· round:   ", roundId.toString());
  console.log("· keeper:  ", keeperKp.publicKey());

  let round = await reader.getRound(roundId);
  console.log("\n[status] ", round.status.tag, "R=", round.reveal_round.toString());

  // ── Phase 1: open + reveal ─────────────────────────────────────────────
  if (round.status.tag === "Open" || round.status.tag === "Revealing") {
    console.log("\n[1/3] keeper: wait R → open_reveal → reveal all…");
    let rev = await keepRound(
      { sdk, drand, log, maxWaitSeconds: 600, pollMs: 5000 },
      roundId,
    );
    for (let i = 0; i < 5 && rev.finalStatus === "Open"; i++) {
      await sleep(5000);
      rev = await keepRound(
        { sdk, drand, log, maxWaitSeconds: 120, pollMs: 5000 },
        roundId,
      );
    }
    console.log("    keep:", JSON.stringify(rev, bigintReplacer));
    if (rev.finalStatus === "Open") {
      throw new Error("reveal not opened — Drand R not yet available");
    }
    round = await reader.getRound(roundId);
  }

  // ── Phase 2: wait reveal deadline ──────────────────────────────────────
  round = await reader.getRound(roundId);
  const revealDeadline = Number(round.reveal_deadline);
  console.log("\n[2/3] waiting for reveal deadline…", revealDeadline);
  while (Math.floor(Date.now() / 1000) <= revealDeadline + 3) {
    const remain = revealDeadline + 4 - Math.floor(Date.now() / 1000);
    if (remain > 0) {
      log(`~${remain}s until clear allowed`);
      await sleep(Math.min(10_000, remain * 1000));
    }
  }

  // ── Phase 3: clear + settle ────────────────────────────────────────────
  console.log("\n[3/3] clear + settle…");
  let close = await closeRound({ sdk, drand, log }, roundId);
  if (!close.settled && close.finalStatus !== "Settled") {
    await sleep(5000);
    close = await closeRound({ sdk, drand, log }, roundId);
  }
  console.log("    close:", JSON.stringify(close, bigintReplacer));

  round = await reader.getRound(roundId);
  if (round.status.tag !== "Settled") {
    throw new Error(`expected Settled, got ${round.status.tag}`);
  }

  const bidders = await reader.getBidders(roundId);
  for (const b of bidders) {
    const st = await reader.getBidState(roundId, b);
    console.log(`    bid ${b.slice(0, 8)}… value=${st.revealed_value?.toString()} valid=${st.valid} settled=${st.settled}`);
  }

  const tokenSacId = nativeXlmSacId(NETWORK);
  const balanceOf = createSacBalanceReader(
    RPC_URL,
    NETWORK,
    tokenSacId,
    keeperKp.publicKey(),
  );
  const contractBalance = await balanceOf(contractId);
  if (contractBalance !== 0n) {
    throw new Error(
      `contract escrow balance guardrail failed: expected 0, got ${contractBalance.toString()} stroops`,
    );
  }

  console.log("\n✅ MAINNET SETTLEMENT COMPLETE");
  console.log("   contract:", contractId);
  console.log("   round:", roundId.toString());
  console.log("   winner:", close.winner ?? round.winner);
  console.log("   final status:", round.status.tag);
}

main().catch((err) => {
  console.error("\n❌ MAINNET SETTLEMENT FAILED");
  console.error(err);
  process.exit(1);
});
