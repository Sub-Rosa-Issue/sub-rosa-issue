// Copyright (c) 2026 Sub Rosa contributors
// SPDX-License-Identifier: MIT
//
// Seal-round commit window — the single off-chain counterpart of the Round
// contract's seal-round check (issue #376).
//
// A bid seal is only meaningful for the Drand round the auction committed to
// open. The contract stores that round as `Round::reveal_round` at
// `create_round` and rejects, inside `commit`, any seal whose round differs —
// with stable errors for too-early, too-late, and malformed round numbers.
// This module enforces the same rule off-chain, before a seal is ever
// encrypted, so both sides reject the same fixture set.

/**
 * Stable reasons a seal round can fall outside the commit window. Mirrors the
 * contract's `Error` variants: SealRoundTooEarly (40), SealRoundTooLate (41),
 * InvalidSealRoundZero (42).
 */
export type SealRoundErrorReason =
  | "seal-round-too-early"
  | "seal-round-too-late"
  | "invalid-seal-round-zero";

export class SealRoundError extends Error {
  readonly reason: SealRoundErrorReason;
  readonly sealRound: number;
  readonly revealRound: number;

  constructor(reason: SealRoundErrorReason, sealRound: number, revealRound: number) {
    super(
      reason === "invalid-seal-round-zero"
        ? `seal round must be a positive integer, got ${sealRound}`
        : `seal round ${sealRound} is outside the commit window: the auction opens at round ${revealRound}`,
    );
    this.name = "SealRoundError";
    this.reason = reason;
    this.sealRound = sealRound;
    this.revealRound = revealRound;
  }
}

/// A round number the quicknet chain can never have published: zero, negative,
/// non-integer, NaN, or beyond Number.MAX_SAFE_INTEGER.
export function isMalformedRound(round: number): boolean {
  return !Number.isSafeInteger(round) || round < 1;
}

/**
 * Validate a seal round against the round the auction committed to open.
 *
 * The allowed reveal round is always the value stored on the auction (`reveal
 * round`), never a caller-supplied value. Throws SealRoundError with a stable
 * `reason` for:
 *  - "invalid-seal-round-zero": zero, negative, non-integer, or unsafe rounds
 *  - "seal-round-too-early": seal round before the auction's round
 *  - "seal-round-too-late":  seal round after the auction's round
 */
export function assertSealRoundWindow(sealRound: number, revealRound: number): void {
  if (isMalformedRound(sealRound)) {
    throw new SealRoundError("invalid-seal-round-zero", sealRound, revealRound);
  }
  if (isMalformedRound(revealRound)) {
    throw new SealRoundError("invalid-seal-round-zero", sealRound, revealRound);
  }
  if (sealRound < revealRound) {
    throw new SealRoundError("seal-round-too-early", sealRound, revealRound);
  }
  if (sealRound > revealRound) {
    throw new SealRoundError("seal-round-too-late", sealRound, revealRound);
  }
}
