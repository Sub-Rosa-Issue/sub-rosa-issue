import { normalizeError } from "@sub-rosa/logging/errors";
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.scripts.mainnet-settle");
// Mainnet settlement — keeper open/reveal + clear/settle.
// Default: read-only dry-run. Add --execute and MAINNET_CONFIRM to submit.

import { Keypair } from "@stellar/stellar-sdk";
import {
  assertMainnetConfirmed,
  createSacBalanceReader,
  MAINNET_ARTIFACTS,
  defaultMainnetReadinessInput,
  nativeXlmSacId,
  runMainnetReadiness,
  SubRosaClient,
} from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";

import { closeRound, keepRound } from "../src/keeper.js";
import { runMainnetSettleGate } from "./mainnet-settle-gate.js";

const { clock, scheduler } = systemTime;

const RPC_URL = process.env.RPC_URL ?? "https://rpc.ankr.com/stellar_soroban";
const NETWORK =
  process.env.NETWORK_PASSPHRASE ??
  "Public Global Stellar Network ; September 2015";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => scheduler.sleep(ms);
const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

async function main() {
  const execute = process.argv.includes("--execute");
  if (execute) assertMainnetConfirmed();

  const keeperSecret = execute ? reqEnv("KEEPER_SECRET") : undefined;
  const contractId = process.env.ROUND_CONTRACT_ID || MAINNET_ARTIFACTS.contractId;
  const roundId = BigInt(process.env.ROUND_ID ?? "1");
  const keeperKp = keeperSecret
    ? Keypair.fromSecret(keeperSecret)
    : Keypair.random();

  const reader = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    publicKey: keeperKp.publicKey(),
  });

  const result = await runMainnetSettleGate({
    execute,
    runReadiness: () =>
      runMainnetReadiness(
        defaultMainnetReadinessInput({
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK,
          contractId,
          withBalances: false,
        }),
        { reader },
      ),
    readSettleAmount: async () => {
      const bidders = await reader.getBidders(roundId);
      let amount = 0n;
      for (const bidder of bidders) {
        const state = await reader.getBidState(roundId, bidder);
        amount += BigInt(state.escrow);
      }
      return amount;
    },
    buildSettle: async () => {
      if (!keeperSecret) throw new Error("KEEPER_SECRET is required to execute");
      const sdk = new SubRosaClient({
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK,
        contractId,
        secretKey: keeperSecret,
      });
      const drand = quicknet();
      const log = (m: string) => diagnostics.info("progress", "    ·", { "m_0": m });

      diagnostics.info("contract", "· contract:", { "contractId_0": contractId });
      diagnostics.info("round", "· round:   ", { "value1_0": roundId.toString() });
      diagnostics.info("keeper", "· keeper:  ", { "value1_0": keeperKp.publicKey() });

      let round = await reader.getRound(roundId);
      diagnostics.info("status", "\n[status] ", { "tag_0": round.status.tag, "value2_1": "R=", "value3_2": round.reveal_round.toString() });

      // ── Phase 1: open + reveal ─────────────────────────────────────────────
      if (round.status.tag === "Open" || round.status.tag === "Revealing") {
        diagnostics.info("1-3-keeper-wait-r-open-reveal-reveal-all", "\n[1/3] keeper: wait R → open_reveal → reveal all…");
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
        diagnostics.info("keep", "    keep:", { "value1_0": JSON.stringify(rev, bigintReplacer) });
        if (rev.finalStatus === "Open") {
          throw new Error("reveal not opened — Drand R not yet available");
        }
        round = await reader.getRound(roundId);
      }

      // ── Phase 2: wait reveal deadline ──────────────────────────────────────
      round = await reader.getRound(roundId);
      const revealDeadline = Number(round.reveal_deadline);
      diagnostics.info("2-3-waiting-for-reveal-deadline", "\n[2/3] waiting for reveal deadline…", { "revealDeadline_0": revealDeadline });
      while (clock.nowSeconds() <= revealDeadline + 3) {
        const remain = revealDeadline + 4 - clock.nowSeconds();
        if (remain > 0) {
          log(`~${remain}s until clear allowed`);
          await sleep(Math.min(10_000, remain * 1000));
        }
      }

      // ── Phase 3: clear + settle ────────────────────────────────────────────
      diagnostics.info("3-3-clear-settle", "\n[3/3] clear + settle…");
      let close = await closeRound({ sdk, drand, log }, roundId);
      if (!close.settled && close.finalStatus !== "Settled") {
        await sleep(5000);
        close = await closeRound({ sdk, drand, log }, roundId);
      }
      diagnostics.info("close", "    close:", { "value1_0": JSON.stringify(close, bigintReplacer) });

      round = await reader.getRound(roundId);
      if (round.status.tag !== "Settled") {
        throw new Error(`expected Settled, got ${round.status.tag}`);
      }

      const bidders = await reader.getBidders(roundId);
      for (const bidder of bidders) {
        const state = await reader.getBidState(roundId, bidder);
        diagnostics.info("bid", `    bid ${bidder.slice(0, 8)}… value=${state.revealed_value?.toString()} valid=${state.valid} settled=${state.settled}`);
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

      diagnostics.info("mainnet-settlement-complete", "\n✅ MAINNET SETTLEMENT COMPLETE");
      diagnostics.info("contract-2", "   contract:", { "contractId_0": contractId });
      diagnostics.info("round-2", "   round:", { "value1_0": roundId.toString() });
      diagnostics.info("winner", "   winner:", { "value1_0": close.winner ?? round.winner });
      diagnostics.info("final-status", "   final status:", { "tag_0": round.status.tag });
    },
  });

  if (!execute) {
    diagnostics.info(
      "mainnet-settle-dry-run",
      "DRY-RUN: readiness passed; no transaction submitted.",
      { "amount_0": result.amount.toString() },
    );
  }
}

main().catch((err) => {
  diagnostics.error("mainnet-settlement-failed", "\n❌ MAINNET SETTLEMENT FAILED");
  diagnostics.error("progress-2", normalizeError(err));
  process.exit(1);
});
