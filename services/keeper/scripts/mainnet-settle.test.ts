import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultMainnetReadinessInput,
  MAINNET_ARTIFACTS,
  MAINNET_MICRO_MAX_ESCROW,
  runMainnetReadiness,
  type ReadinessCheck,
} from "@sub-rosa/sdk";

import {
  parseSettleAmount,
  runMainnetSettleGate,
} from "./mainnet-settle-gate.js";

const passingChecks: ReadinessCheck[] = [
  {
    id: "fixture",
    label: "Fixture readiness",
    status: "pass",
    message: "matches the frozen mainnet fixture",
  },
];

describe("mainnet settle gate", () => {
  it("does not build a settle when strict readiness is blocked", async () => {
    let builds = 0;
    let amountReads = 0;

    await assert.rejects(
      runMainnetSettleGate({
        execute: true,
        async runReadiness() {
          return {
            checks: [
              {
                ...passingChecks[0]!,
                status: "block",
                message: "fixture mismatch",
              },
            ],
          };
        },
        async readSettleAmount() {
          amountReads += 1;
          return 1n;
        },
        async buildSettle() {
          builds += 1;
        },
      }),
      /mainnet readiness blocked/,
    );

    assert.equal(builds, 0);
  assert.equal(amountReads, 0);
  });

  it("does not build a settle when the amount exceeds the committed cap", async () => {
    let builds = 0;

    await assert.rejects(
      runMainnetSettleGate({
        execute: true,
        async runReadiness() {
          return { checks: passingChecks };
        },
        async readSettleAmount() {
          return MAINNET_MICRO_MAX_ESCROW + 1n;
        },
        async buildSettle() {
          builds += 1;
        },
      }),
      /exceeds MAINNET_MICRO_MAX_ESCROW/,
    );

    assert.equal(builds, 0);
  });

  it("runs a matching fixture dry-run without submitting or contacting mainnet", async () => {
    let submissions = 0;
    const result = await runMainnetSettleGate({
      execute: false,
      async runReadiness() {
        return runMainnetReadiness(
          defaultMainnetReadinessInput({
            contractId: MAINNET_ARTIFACTS.contractId,
            live: false,
          }),
        );
      },
      async readSettleAmount() {
        return "5000000";
      },
      async buildSettle() {
        submissions += 1;
      },
    });

    assert.deepEqual(result, { amount: 5_000_000n, submitted: false });
    assert.equal(submissions, 0);
  });

  it("rejects zero and non-integer settle amounts", () => {
    assert.throws(() => parseSettleAmount(0n), /must be positive/);
    assert.throws(() => parseSettleAmount("1.5"), /must be an integer/);
    assert.throws(() => parseSettleAmount(1.5), /must be an integer/);
  });
});