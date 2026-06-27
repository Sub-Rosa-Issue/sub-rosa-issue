import { sealScores, verifyReveal, settleGrant } from "./grant-scoring.js";

const PROJECTS = [
  { id: "p1", name: "Project A", description: "" },
  { id: "p2", name: "Project B", description: "" },
];
const JUDGES = [{ publicKey: "G1", name: "Judge 1" }, { publicKey: "G2", name: "Judge 2" }];
const CONFIG = { roundId: "r1", projects: PROJECTS, judges: JUDGES, drandRound: 100 };

describe("grant scoring template", () => {
  it("seals scores into commitments", () => {
    const sealed = sealScores(CONFIG, [
      { judgePublicKey: "G1", projectId: "p1", score: 80, salt: "abc" },
    ]);
    expect(sealed).toHaveLength(1);
    expect(sealed[0].commitment).toContain("G1");
    expect(sealed[0].commitment).toContain("80");
  });

  it("verifies a matching reveal", () => {
    const sealed = sealScores(CONFIG, [
      { judgePublicKey: "G1", projectId: "p1", score: 80, salt: "abc" },
    ]);
    const valid = verifyReveal(sealed[0], { judgePublicKey: "G1", projectId: "p1", score: 80, salt: "abc", commitment: sealed[0].commitment });
    expect(valid).toBe(true);
  });

  it("rejects a tampered reveal", () => {
    const sealed = sealScores(CONFIG, [
      { judgePublicKey: "G1", projectId: "p1", score: 80, salt: "abc" },
    ]);
    const invalid = verifyReveal(sealed[0], { judgePublicKey: "G1", projectId: "p1", score: 99, salt: "abc", commitment: sealed[0].commitment });
    expect(invalid).toBe(false);
  });

  it("settles to the highest-scored project", () => {
    const reveals = [
      { judgePublicKey: "G1", projectId: "p1", score: 70, salt: "a", commitment: "" },
      { judgePublicKey: "G2", projectId: "p1", score: 80, salt: "b", commitment: "" },
      { judgePublicKey: "G1", projectId: "p2", score: 50, salt: "c", commitment: "" },
      { judgePublicKey: "G2", projectId: "p2", score: 60, salt: "d", commitment: "" },
    ];
    const receipt = settleGrant(CONFIG, reveals);
    expect(receipt.winner.id).toBe("p1");
  });

  it("handles projects with no scores", () => {
    const reveals = [
      { judgePublicKey: "G1", projectId: "p1", score: 90, salt: "a", commitment: "" },
    ];
    const receipt = settleGrant(CONFIG, reveals);
    expect(receipt.winner.id).toBe("p1");
    const p2 = receipt.scores.find(s => s.projectId === "p2");
    expect(p2?.averageScore).toBe(0);
  });
});
