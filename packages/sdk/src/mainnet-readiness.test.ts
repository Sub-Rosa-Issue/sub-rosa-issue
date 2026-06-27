import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BidState, Round } from "@sub-rosa/round-bindings";

import {
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  defaultMainnetReadinessInput,
  hasBlockingFailures,
  runMainnetReadiness,
  verifySettledRoundProof,
  type MainnetReadinessDeps,
} from "./mainnet-readiness.js";
import {
  MAINNET_ARTIFACTS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_MICRO_MAX_ESCROW,
} from "./mainnet-artifacts.js";

const mockRpc = (balance = "1000000000"): MainnetReadinessDeps["rpc"] =>
  ({
    getHealth: async () => ({ status: "healthy", latestLedger: 123, ledgerRetentionWindow: 1000, oldestLedger: 1 }),
    getLatestLedger: async () => ({ sequence: 123 }),
    getLedgerEntries: async () => ({ entries: [], latestLedger: 123 }),
    getAccountEntry: async () =>
      ({ balance: () => ({ toString: () => balance }) }),
    simulateTransaction: async () => ({ result: { retval: 0n } }),
  }) as unknown as MainnetReadinessDeps["rpc"];

const CONTRACT_ID = MAINNET_ARTIFACTS.contractId;
const BIDDER = "GBIDDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const settledRound = {
  auditor_pubkey: Buffer.alloc(32),
  bidders: [BIDDER],
  clearing_rule: { tag: "HighestBid", values: undefined },
  commit_deadline: 100n,
  item_ref: Buffer.alloc(32),
  operator: "GOPERATOR",
  reveal_deadline: 1_000n,
  reveal_round: BigInt(MAINNET_ARTIFACTS.revealRound),
  status: { tag: "Settled", values: undefined },
  winner: BIDDER,
  winning_bid: MAINNET_ARTIFACTS.bidStroops,
} as Round;

const settledBidState: BidState = {
  commitment: Buffer.alloc(32),
  escrow: MAINNET_ARTIFACTS.escrowStroops,
  revealed_value: MAINNET_ARTIFACTS.bidStroops,
  settled: true,
  valid: true,
};

describe("assertMainnetConfirmed", () => {
  it("accepts the required confirmation phrase", () => {
    assert.doesNotThrow(() =>
      assertMainnetConfirmed({ MAINNET_CONFIRM: MAINNET_CONFIRM_PHRASE }),
    );
  });

  it("rejects missing or wrong confirmation", () => {
    assert.throws(() => assertMainnetConfirmed({}), /MAINNET_CONFIRM/);
    assert.throws(
      () => assertMainnetConfirmed({ MAINNET_CONFIRM: "yes" }),
      /MAINNET_CONFIRM/,
    );
  });
});

describe("assertMicroAmounts", () => {
  it("accepts micro amounts within the escrow cap", () => {
    assert.doesNotThrow(() => assertMicroAmounts(500_000n, 1_000_000n));
  });

  it("rejects bid above escrow or above cap", () => {
    assert.throws(
      () => assertMicroAmounts(2_000_000n, 1_000_000n),
      /cannot exceed escrow/,
    );
    assert.throws(
      () => assertMicroAmounts(1n, MAINNET_MICRO_MAX_ESCROW + 1n),
      /MAINNET_MICRO_MAX_ESCROW/,
    );
  });
});

describe("verifySettledRoundProof", () => {
  it("passes when round state matches frozen artifacts", async () => {
    const reader = {
      getRound: async () => settledRound,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };

    await verifySettledRoundProof(reader, 1n, {
      bidStroops: MAINNET_ARTIFACTS.bidStroops,
      escrowStroops: MAINNET_ARTIFACTS.escrowStroops,
      revealRound: MAINNET_ARTIFACTS.revealRound,
    });
  });

  it("fails when status is not settled", async () => {
    const reader = {
      getRound: async () =>
        ({ ...settledRound, status: { tag: "Open", values: undefined } }) as Round,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };

    await assert.rejects(
      () =>
        verifySettledRoundProof(reader, 1n, {
          bidStroops: MAINNET_ARTIFACTS.bidStroops,
          escrowStroops: MAINNET_ARTIFACTS.escrowStroops,
          revealRound: MAINNET_ARTIFACTS.revealRound,
        }),
      /Settled/,
    );
  });
});

describe("runMainnetReadiness", () => {
  it("returns dry-run warnings without live RPC dependencies", async () => {
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({ live: false, withBalances: true }),
    );

    assert.equal(report.mode, "dry-run");
    assert.ok(report.warnCount >= 3);
    assert.equal(report.blockCount, 0);
    assert.equal(hasBlockingFailures(report.checks), false);
  });

  it("blocks on wasm hash mismatch with mocked RPC", async () => {
    const reader = {
      getRound: async () => settledRound,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({ contractId: CONTRACT_ID }),
      {
        reader,
        rpc: mockRpc(),
        fetchWasmHash: async () => "deadbeef".repeat(8),
      },
    );

    const wasmCheck = report.checks.find((c) => c.id === "wasm-hash");
    assert.equal(wasmCheck?.status, "block");
    assert.throws(() => assertReadinessForExecute(report.checks), /wasm-hash/);
  });

  it("passes live checks with mocked dependencies", async () => {
    const reader = {
      getRound: async () => settledRound,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        withBalances: true,
        operatorAccount: "GOPERATOR",
      }),
      {
        reader,
        rpc: mockRpc("500000000"),
        fetchWasmHash: async () => MAINNET_ARTIFACTS.wasmHash,
        sacBalance: async (addr) => (addr === CONTRACT_ID ? 0n : 1n),
      },
    );

    assert.equal(hasBlockingFailures(report.checks), false);
    assert.ok(report.passCount >= 5);
  });

  it("blocks when contract escrow balance is non-zero", async () => {
    const reader = {
      getRound: async () => settledRound,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({ withBalances: true }),
      {
        reader,
        rpc: {
          ...mockRpc(),
          simulateTransaction: async () =>
            ({ result: { retval: 1n } }) as unknown as Awaited<
              ReturnType<NonNullable<MainnetReadinessDeps["rpc"]>["simulateTransaction"]>
            >,
        } as MainnetReadinessDeps["rpc"],
        fetchWasmHash: async () => MAINNET_ARTIFACTS.wasmHash,
        sacBalance: async () => 1_000_000n,
      },
    );

    const balanceCheck = report.checks.find((c) => c.id === "contract-balance");
    assert.equal(balanceCheck?.status, "block");
  });
});
