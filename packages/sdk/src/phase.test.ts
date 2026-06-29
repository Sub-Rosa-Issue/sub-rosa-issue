import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRoundPhase, type RoundLike } from "./phase.js";

const COMMIT_DEADLINE = 100n;
const REVEAL_DEADLINE = 1000n;

const mockOpenRound = {
  status: { tag: "Open" },
  commit_deadline: COMMIT_DEADLINE,
  reveal_deadline: REVEAL_DEADLINE,
} as RoundLike;

const mockRevealingRound = {
  status: { tag: "Revealing" },
  commit_deadline: COMMIT_DEADLINE,
  reveal_deadline: REVEAL_DEADLINE,
} as RoundLike;

const mockClearedRound = {
  status: { tag: "Cleared" },
  commit_deadline: COMMIT_DEADLINE,
  reveal_deadline: REVEAL_DEADLINE,
} as RoundLike;

const mockSettledRound = {
  status: { tag: "Settled" },
  commit_deadline: COMMIT_DEADLINE,
  reveal_deadline: REVEAL_DEADLINE,
} as RoundLike;

const mockVoidedRound = {
  status: { tag: "Voided" },
  commit_deadline: COMMIT_DEADLINE,
  reveal_deadline: REVEAL_DEADLINE,
} as RoundLike;

describe("classifyRoundPhase - Setup Phase", () => {
  it("classifies undefined round as setup", () => {
    assert.equal(classifyRoundPhase(undefined, 0), "setup");
  });

  it("classifies null round as setup", () => {
    assert.equal(classifyRoundPhase(null, 50n), "setup");
  });
});

describe("classifyRoundPhase - Commit Phase Boundaries", () => {
  it("is 'commit' well before commit deadline", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, 0n), "commit");
    assert.equal(classifyRoundPhase(mockOpenRound, 50n), "commit");
  });

  it("is 'commit' exactly 1 second before the commit deadline", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, COMMIT_DEADLINE - 1n), "commit");
  });

  it("is 'commit' exactly at the commit deadline (boundary)", () => {
    // Contract allows commits at/before the commit deadline
    assert.equal(classifyRoundPhase(mockOpenRound, COMMIT_DEADLINE), "commit");
  });

  it("transitions to 'reveal/settle' exactly 1 second after the commit deadline", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, COMMIT_DEADLINE + 1n), "reveal/settle");
  });

  it("is 'reveal/settle' well after the commit deadline", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, COMMIT_DEADLINE + 400n), "reveal/settle");
  });
});

describe("classifyRoundPhase - Reveal / Settle Phase Boundaries", () => {
  // 1. Open status but commit closed (pre-reveal wait)
  it("keeps 'reveal/settle' during waiting period", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, COMMIT_DEADLINE + 5n), "reveal/settle");
  });

  // 2. Revealing status (active reveal window)
  it("is 'reveal/settle' well before reveal deadline (status = Revealing)", () => {
    assert.equal(classifyRoundPhase(mockRevealingRound, COMMIT_DEADLINE + 10n), "reveal/settle");
  });

  it("is 'reveal/settle' exactly 1 second before reveal deadline (status = Revealing)", () => {
    assert.equal(classifyRoundPhase(mockRevealingRound, REVEAL_DEADLINE - 1n), "reveal/settle");
  });

  it("is 'reveal/settle' exactly at reveal deadline (status = Revealing)", () => {
    assert.equal(classifyRoundPhase(mockRevealingRound, REVEAL_DEADLINE), "reveal/settle");
  });

  it("is 'reveal/settle' exactly 1 second after reveal deadline (status = Revealing)", () => {
    assert.equal(classifyRoundPhase(mockRevealingRound, REVEAL_DEADLINE + 1n), "reveal/settle");
  });

  // 3. Cleared status (awaiting settlement)
  it("is 'reveal/settle' once Cleared, regardless of timestamp", () => {
    assert.equal(classifyRoundPhase(mockClearedRound, REVEAL_DEADLINE + 5n), "reveal/settle");
    assert.equal(classifyRoundPhase(mockClearedRound, REVEAL_DEADLINE + 10000n), "reveal/settle");
  });
});

describe("classifyRoundPhase - Closed Phase States", () => {
  it("is 'closed' once Settled, regardless of timestamp", () => {
    assert.equal(classifyRoundPhase(mockSettledRound, 0n), "closed");
    assert.equal(classifyRoundPhase(mockSettledRound, REVEAL_DEADLINE + 5000n), "closed");
  });

  it("is 'closed' once Voided, regardless of timestamp", () => {
    assert.equal(classifyRoundPhase(mockVoidedRound, 0n), "closed");
    assert.equal(classifyRoundPhase(mockVoidedRound, REVEAL_DEADLINE + 5000n), "closed");
  });
});

describe("classifyRoundPhase - Invalid / Unknown clock & status", () => {
  it("returns 'unknown' for negative timestamp values", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, -1n), "unknown");
    assert.equal(classifyRoundPhase(mockOpenRound, -500), "unknown");
  });

  it("returns 'unknown' for invalid string timestamps", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, "not-a-number"), "unknown");
  });

  it("returns 'unknown' for NaN / non-finite timestamps", () => {
    assert.equal(classifyRoundPhase(mockOpenRound, NaN), "unknown");
    assert.equal(classifyRoundPhase(mockOpenRound, Infinity), "unknown");
  });

  it("returns 'unknown' for unknown round statuses", () => {
    const corruptRound = {
      ...mockOpenRound,
      status: { tag: "MaliciousFakeStatus" },
    };
    assert.equal(classifyRoundPhase(corruptRound, 10n), "unknown");
  });

  it("returns 'unknown' for missing or malformed status object", () => {
    const corruptRound = {
      ...mockOpenRound,
      status: undefined,
    } as unknown as RoundLike;
    assert.equal(classifyRoundPhase(corruptRound, 10n), "unknown");
  });

  it("returns 'unknown' for negative deadlines", () => {
    const corruptRound = {
      ...mockOpenRound,
      commit_deadline: -10n,
    };
    assert.equal(classifyRoundPhase(corruptRound, 10n), "unknown");
  });

  it("returns 'unknown' for invalid, NaN or malformed deadlines", () => {
    const corruptRound1 = {
      ...mockOpenRound,
      commit_deadline: NaN,
    };
    assert.equal(classifyRoundPhase(corruptRound1, 10n), "unknown");

    const corruptRound2 = {
      ...mockOpenRound,
      reveal_deadline: "not-a-deadline",
    };
    assert.equal(classifyRoundPhase(corruptRound2, 10n), "unknown");
  });
});

describe("classifyRoundPhase - Input Type Support (bigint, number, string)", () => {
  it("handles deadlines and timestamps as numbers", () => {
    const roundNumber = {
      status: { tag: "Open" },
      commit_deadline: 100,
      reveal_deadline: 1000,
    } as RoundLike;
    assert.equal(classifyRoundPhase(roundNumber, 50), "commit");
    assert.equal(classifyRoundPhase(roundNumber, 150), "reveal/settle");
  });

  it("handles deadlines and timestamps as strings", () => {
    const roundString = {
      status: { tag: "Open" },
      commit_deadline: "100",
      reveal_deadline: "1000",
    } as unknown as RoundLike;
    assert.equal(classifyRoundPhase(roundString, "50"), "commit");
    assert.equal(classifyRoundPhase(roundString, "150"), "reveal/settle");
  });

  it("handles mixed types cleanly", () => {
    const mixedRound = {
      status: { tag: "Open" },
      commit_deadline: "100",
      reveal_deadline: 1000n,
    } as unknown as RoundLike;
    assert.equal(classifyRoundPhase(mixedRound, 50), "commit");
  });
});
