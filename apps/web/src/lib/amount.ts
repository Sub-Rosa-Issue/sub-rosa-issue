// Copyright (c) 2026 Sub Rosa contributors

export function formatEscrowAmount(value: bigint, tokenLabel: string): string {
  const SCALE = 10_000_000n;
  const QUANTA = 10_000n;

  const whole = value / SCALE;
  const remainder = value % SCALE;
  const fractional = (remainder * QUANTA + (SCALE / 2n)) / SCALE;

  const normalizedWhole = fractional >= QUANTA ? whole + 1n : whole;
  const normalizedFraction = fractional >= QUANTA ? 0n : fractional;

  return `${normalizedWhole}.${normalizedFraction.toString().padStart(4, "0")} ${tokenLabel}`;
}
