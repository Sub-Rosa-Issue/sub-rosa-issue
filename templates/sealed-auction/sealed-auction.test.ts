import { sealBid, verifyBidReveal, settleAuction } from "./sealed-auction.js";

const CONFIG = {
  roundId: "auction-1",
  sacContractId: "CSAC",
  revealDrandRound: 200,
  minimumBid: 100n,
};

describe("sealed auction template", () => {
  it("seals a bid into a commitment", () => {
    const bid = sealBid("G1", 500n, "salt1", 600n);
    expect(bid.commitment).toContain("G1");
    expect(bid.commitment).toContain("500");
    expect(bid.escrowAmount).toBe(600n);
  });

  it("throws when escrow < bid", () => {
    expect(() => sealBid("G1", 500n, "s", 400n)).toThrow("escrowAmount");
  });

  it("verifies a matching reveal", () => {
    const sealed = sealBid("G1", 500n, "salt1", 600n);
    const revealed = { bidderPublicKey: "G1", bidAmount: 500n, salt: "salt1", commitment: sealed.commitment, escrowAmount: 600n };
    expect(verifyBidReveal(sealed, revealed)).toBe(true);
  });

  it("rejects a tampered reveal", () => {
    const sealed = sealBid("G1", 500n, "salt1", 600n);
    const revealed = { bidderPublicKey: "G1", bidAmount: 999n, salt: "salt1", commitment: sealed.commitment, escrowAmount: 600n };
    expect(verifyBidReveal(sealed, revealed)).toBe(false);
  });

  it("settles to the highest bidder", () => {
    const s1 = sealBid("G1", 500n, "a", 600n);
    const s2 = sealBid("G2", 800n, "b", 900n);
    const r1 = { bidderPublicKey: "G1", bidAmount: 500n, salt: "a", commitment: s1.commitment, escrowAmount: 600n };
    const r2 = { bidderPublicKey: "G2", bidAmount: 800n, salt: "b", commitment: s2.commitment, escrowAmount: 900n };
    const result = settleAuction(CONFIG, [s1, s2], [r1, r2]);
    expect(result.winner).toBe("G2");
    expect(result.winningBid).toBe(800n);
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].bidderPublicKey).toBe("G1");
  });

  it("throws when no valid bids", () => {
    const s1 = sealBid("G1", 500n, "a", 600n);
    expect(() => settleAuction(CONFIG, [s1], [])).toThrow("No valid bids");
  });
});
