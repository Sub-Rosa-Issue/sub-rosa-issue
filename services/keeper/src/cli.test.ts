import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeeperCli } from "./run.js";

test("keeper cli exits 0 for dry-run success", async () => {
  const lines: string[] = [];
  const io = {
    stdout: { log: (...args: unknown[]) => lines.push(args.join(" ")) },
    stderr: { error: (...args: unknown[]) => lines.push(args.join(" ")) },
  };

  const exitCode = await runKeeperCli(
    {
      ROUND_CONTRACT_ID: "C123",
      ROUND_ID: "1",
      KEEPER_DRY_RUN: "true",
    },
    io as any,
    {
      createClient: () => ({
        getRound: async () => ({
          status: { tag: "Open" },
          reveal_deadline: 1n,
          reveal_round: 1n,
          bidders: ["GA4GN"],
        }),
        getBidState: async () => ({ revealed_value: null }),
      }),
      buildDryRunSummary: async (_reader, roundId) => ({
        mode: "dry-run",
        roundId,
        status: "Open",
        drandRound: 1n,
        bidderCount: 1,
        revealedCount: 0,
        currentPhase: "awaiting-drand",
        nextAction: "open reveal when the configured Drand round is published",
        transactionsSubmitted: 0,
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.match(lines.join("\n"), /keeper dry-run summary/);
});

test("keeper cli exits 1 for missing config", async () => {
  const lines: string[] = [];
  const io = {
    stdout: { log: (...args: unknown[]) => lines.push(args.join(" ")) },
    stderr: { error: (...args: unknown[]) => lines.push(args.join(" ")) },
  };

  const exitCode = await runKeeperCli({}, io as any);

  assert.equal(exitCode, 1);
  assert.match(lines.join("\n"), /missing required env var/);
});
