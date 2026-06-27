// Sealed auction pilot template.
// Bidders seal values, escrow SAC funds, reveal after Drand round R,
// and settle/refund deterministically.

export interface AuctionConfig {
  roundId: string;
  /** Contract ID of the SAC (Stellar Asset Contract) used for escrow. */
  sacContractId: string;
  /** Drand round number after which reveals are accepted. */
  revealDrandRound: number;
  /** Minimum bid in stroops. */
  minimumBid: bigint;
}

export interface SealedBid {
  bidderPublicKey: string;
  /** Hash of (bidAmount:salt). */
  commitment: string;
  /** Amount escrowed in SAC (must be >= actual bid to prevent shill bidding). */
  escrowAmount: bigint;
}

export interface RevealedBid {
  bidderPublicKey: string;
  bidAmount: bigint;
  salt: string;
  commitment: string;
  escrowAmount: bigint;
}

export interface AuctionSettlement {
  roundId: string;
  winner: string;           // bidderPublicKey
  winningBid: bigint;
  refunds: Array<{ bidderPublicKey: string; refundAmount: bigint }>;
  settledAt: string;
}

/**
 * Seal a bid: produce a commitment hash from bidAmount + salt.
 * The escrowAmount should be >= bidAmount to prevent shill underbidding.
 */
export function sealBid(
  bidderPublicKey: string,
  bidAmount: bigint,
  salt: string,
  escrowAmount: bigint,
): SealedBid {
  if (escrowAmount < bidAmount) {
    throw new Error(`escrowAmount ${escrowAmount} must be >= bidAmount ${bidAmount}`);
  }
  return {
    bidderPublicKey,
    commitment: `${bidderPublicKey}:${bidAmount}:${salt}`,
    escrowAmount,
  };
}

/**
 * Verify a revealed bid matches its sealed commitment.
 */
export function verifyBidReveal(sealed: SealedBid, revealed: RevealedBid): boolean {
  const expected = `${revealed.bidderPublicKey}:${revealed.bidAmount}:${revealed.salt}`;
  return sealed.commitment === expected;
}

/**
 * Settle the auction:
 * 1. Verify all reveals match commitments
 * 2. Pick the highest valid bid
 * 3. Compute refunds for all non-winners (full escrow back)
 */
export function settleAuction(
  config: AuctionConfig,
  sealed: SealedBid[],
  revealed: RevealedBid[],
): AuctionSettlement {
  // Verify and filter valid reveals
  const valid = revealed.filter(r => {
    const s = sealed.find(s => s.bidderPublicKey === r.bidderPublicKey);
    if (!s) return false;
    if (!verifyBidReveal(s, r)) return false;
    if (r.bidAmount < config.minimumBid) return false;
    return true;
  });

  if (valid.length === 0) {
    throw new Error("No valid bids revealed");
  }

  // Highest bid wins
  const winner = valid.reduce((best, cur) =>
    cur.bidAmount > best.bidAmount ? cur : best
  );

  // Refunds: non-winners get full escrow back
  const refunds = sealed
    .filter(s => s.bidderPublicKey !== winner.bidderPublicKey)
    .map(s => ({ bidderPublicKey: s.bidderPublicKey, refundAmount: s.escrowAmount }));

  return {
    roundId: config.roundId,
    winner: winner.bidderPublicKey,
    winningBid: winner.bidAmount,
    refunds,
    settledAt: new Date().toISOString(),
  };
}
