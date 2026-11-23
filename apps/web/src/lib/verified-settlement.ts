// Copyright (c) 2026 Sub Rosa contributors
// Single verified settlement result shared by the settlement rail and the
// outcome panel. Amounts only exist once the SDK receipt verifier accepts the
// receipt, so neither component can guess a winner from partial UI state.
import { verifyReceipt, type RoundReceipt, type VerificationResult } from "@sub-rosa/sdk";

export interface VerifiedRefund {
  address: string;
  /** Escrow returned to a non-winning bidder, in stroops. */
  amount: bigint;
}

export type VerifiedSettlement =
  | { state: "pending" }
  | { state: "rejected"; code: string }
  | {
      state: "verified";
      winner: { address: string; value: bigint } | null;
      refunds: VerifiedRefund[];
    };

export const PENDING_SETTLEMENT: VerifiedSettlement = { state: "pending" };

/**
 * Run the receipt through the SDK verifier and derive the one winner and
 * refund set both settlement components render. A rejected receipt yields
 * only the first error code and no amounts.
 */
export function verifySettlement(
  receipt: RoundReceipt,
  verify: (receipt: RoundReceipt) => VerificationResult = verifyReceipt,
): VerifiedSettlement {
  let result: VerificationResult;
  try {
    result = verify(receipt);
  } catch {
    return { state: "rejected", code: "verifier_error" };
  }
  if (!result.valid) {
    const error = result.issues.find((issue) => issue.severity === "error");
    return { state: "rejected", code: error?.code ?? "invalid_receipt" };
  }
  const { address, value } = result.computedWinner;
  if (address !== receipt.winner || (address !== null && value === null)) {
    return { state: "rejected", code: "winner_not_verified" };
  }
  const winner = address !== null && value !== null ? { address, value } : null;
  if ((winner?.value.toString() ?? null) !== receipt.winningValue) {
    return { state: "rejected", code: "winning_value_mismatch" };
  }
  const refunds: VerifiedRefund[] = receipt.bidders
    .filter((bidder) => bidder !== winner?.address && receipt.bids[bidder]?.settled === true)
    .map((bidder) => ({ address: bidder, amount: BigInt(receipt.bids[bidder]!.escrow) }));
  return { state: "verified", winner, refunds };
}
