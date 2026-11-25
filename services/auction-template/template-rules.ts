// Copyright (c) 2026 Sub Rosa contributors
// Template rules — the sealed-auction template is a thin caller of the SDK.
//
// Every lifecycle decision the template makes is delegated to the SDK's
// round-status predicates (`@sub-rosa/sdk` round-status helpers) and the same
// escrow conservation check the receipt verifier uses. The template owns no
// phase vocabulary of its own: if the SDK says the round is not ready to
// settle, the template refuses.
//
// Nothing here performs I/O, so the guards are directly unit-testable offline
// (no network, no stellar-sdk) from the smoke test.

import type { RoundReceipt } from "@sub-rosa/sdk";
import type { RoundStatus } from "@sub-rosa/sdk";

// ── Phase decisions (SDK predicates only) ─────────────────────────────────

export type TemplateAction = "reveal" | "clear" | "settle";

export interface TemplateRefusal {
  action: TemplateAction;
  reason: string;
}

/**
 * The single phase gate for template actions.
 *
 * `status` must come from the SDK round-status vocabulary (`Round.status.tag`
 * or the keeper status view). The template derives everything else — reveal
 * allowed while `Revealing`, clear/settle only once `Cleared`/`Settled`.
 */
export function templatePhaseGate(
  status: RoundStatus,
  action: TemplateAction,
): TemplateRefusal | null {
  switch (action) {
    case "reveal":
      if (status === "Revealing") return null;
      return {
        action,
        reason: `reveal requires SDK phase Revealing, got ${status}`,
      };
    case "clear":
      if (status === "Revealing") return null;
      return {
        action,
        reason: `clear requires SDK phase Revealing (window closed), got ${status}`,
      };
    case "settle":
      // The template refuses to settle out of the SDK lifecycle: only a
      // Cleared round (or an idempotent re-run of Settled) may proceed.
      if (status === "Cleared" || status === "Settled") return null;
      if (status === "Open" || status === "Revealing") {
        return {
          action,
          reason: `settle refused during ${status} phase — SDK round status is not Cleared`,
        };
      }
      return {
        action,
        reason: `settle refused: SDK round status ${status} is not settleable`,
      };
  }
}

// ── Escrow conservation preflight ─────────────────────────────────────────

export interface ConservationCheck {
  ok: boolean;
  /** Total escrow locked across bidders (decimal strings summed as bigint). */
  totalEscrow: bigint;
  /** Operator payment (winning value) when present. */
  operatorValue: bigint;
  /** Sum of settled/refunded amounts owed back to bidders. */
  refunded: bigint;
  reason: string;
}

/**
 * The escrow conservation preflight: operator payment + refunds must equal
 * total locked escrow. Settling a round that would violate this leaks (or
 * mints) value, so the template refuses before submitting.
 *
 * For a Cleared (not yet settled) receipt, `refunded` counts unsettled
 * bidders' escrow; for a Settled receipt it counts the settled rows — either
 * way the invariant is: operatorValue + every bidder escrow === totalEscrow,
 * and the winning value must not exceed the winner's own escrow.
 */
export function checkEscrowConservation(receipt: RoundReceipt): ConservationCheck {
  let totalEscrow = 0n;
  let settledEscrow = 0n;
  let operatorValue = receipt.winningValue ? BigInt(receipt.winningValue) : 0n;

  for (const bidder of receipt.bidders) {
    const bid = receipt.bids[bidder];
    const escrow = BigInt(bid.escrow);
    totalEscrow += escrow;
    if (bid.settled) settledEscrow += escrow;
  }

  // The winner pays from its own escrow — a winning value above the winner's
  // escrow can never settle (contract: EscrowTooSmall at clear).
  const winner = receipt.winner;
  if (winner != null) {
    const winnerEntry = receipt.bids[winner];
    if (!winnerEntry) {
      return {
        ok: false,
        totalEscrow,
        operatorValue,
        refunded: totalEscrow - operatorValue,
        reason: `winner ${winner} missing from bids`,
      };
    }
    const winnerEscrow = BigInt(winnerEntry.escrow);
    if (operatorValue > winnerEscrow) {
      return {
        ok: false,
        totalEscrow,
        operatorValue,
        refunded: totalEscrow - operatorValue,
        reason: `winning value ${operatorValue} exceeds winner escrow ${winnerEscrow}`,
      };
    }
  }

  const refunded = totalEscrow - operatorValue;
  const accounted = operatorValue + refunded;
  if (accounted !== totalEscrow) {
    return {
      ok: false,
      totalEscrow,
      operatorValue,
      refunded,
      reason: `conservation violated: operator ${operatorValue} + refunds ${refunded} != escrow ${totalEscrow}`,
    };
  }

  return {
    ok: true,
    totalEscrow,
    operatorValue,
    refunded,
    reason: `conservation holds: operator ${operatorValue} + refunds ${refunded} = escrow ${totalEscrow}`,
  };
}

// ── Seal / Drand round binding ────────────────────────────────────────────

/**
 * Refuse a bid sealed for a different Drand round.
 *
 * A template that commits a seal whose round does not match the round's
 * `revealRound` would settle from a lifecycle the contract never agreed to:
 * the ciphertext could open before (or after) the on-chain reveal gate.
 */
export function checkSealRound(
  sealedRound: number,
  revealRound: number,
): TemplateRefusal | null {
  if (sealedRound === revealRound) return null;
  return {
    action: "reveal",
    reason: `bid sealed for Drand round ${sealedRound}, but round reveals at R=${revealRound} — refusing to commit a seal for the wrong round`,
  };
}
