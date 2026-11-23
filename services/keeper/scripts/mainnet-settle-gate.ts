import {
  assertReadinessForExecute,
  MAINNET_MICRO_MAX_ESCROW,
  type ReadinessCheck,
} from "@sub-rosa/sdk";

export function parseSettleAmount(
  amount: unknown,
  maxAmount: bigint = MAINNET_MICRO_MAX_ESCROW,
): bigint {
  let parsed: bigint;
  if (typeof amount === "bigint") {
    parsed = amount;
  } else if (typeof amount === "number" && Number.isSafeInteger(amount)) {
    parsed = BigInt(amount);
  } else if (typeof amount === "string" && /^\d+$/.test(amount)) {
    parsed = BigInt(amount);
  } else {
    throw new Error("settle amount must be an integer number of stroops");
  }

  if (parsed <= 0n) {
    throw new Error("settle amount must be positive");
  }
  if (parsed > maxAmount) {
    throw new Error(
      `settle amount ${parsed} exceeds MAINNET_MICRO_MAX_ESCROW (${maxAmount})`,
    );
  }
  return parsed;
}

export interface MainnetSettleGateOptions {
  execute: boolean;
  runReadiness: () => Promise<{ checks: ReadinessCheck[] }>;
  readSettleAmount: () => Promise<unknown>;
  buildSettle: (amount: bigint) => Promise<void>;
}

export async function runMainnetSettleGate(
  options: MainnetSettleGateOptions,
): Promise<{ amount: bigint; submitted: boolean }> {
  const readiness = await options.runReadiness();
  assertReadinessForExecute(readiness.checks);

  const amount = parseSettleAmount(await options.readSettleAmount());
  if (!options.execute) return { amount, submitted: false };

  await options.buildSettle(amount);
  return { amount, submitted: true };
}