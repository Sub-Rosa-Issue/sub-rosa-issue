// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { networkFingerprint, type RoundReceipt } from "@sub-rosa/sdk";
import { OutcomePanel } from "./OutcomePanel";
import { SettlementRail } from "./SettlementRail";
import { PENDING_SETTLEMENT, verifySettlement, type VerifiedSettlement } from "../lib/verified-settlement";
import { USE_CASES } from "../config/useCases";
import type { DemoTrace } from "../demo/trace";

const W = `G${"W".repeat(55)}`;
const L = `G${"L".repeat(55)}`;
const NETWORK = "Test SDF Network ; September 2015";

function bid(value: string | null, settled: boolean, escrow = "1000000000") {
  return {
    commitment: "ab".repeat(32), escrow, revealedValue: value, nonce: null,
    hashValid: value === null ? null : true, valid: value !== null, settled,
    evidence: { ciphertext: null, auditorBlob: null },
  };
}

function receipt(overrides: Partial<RoundReceipt> = {}): RoundReceipt {
  return {
    version: 1, network: NETWORK, networkFingerprint: networkFingerprint(NETWORK),
    contractId: `C${"A".repeat(55)}`, exportedAt: "2026-01-01T00:00:00.000Z",
    roundId: "7", itemRef: "00".repeat(32), revealRound: 1, clearingRule: "HighestBid",
    commitDeadline: "1", revealDeadline: "2", operator: `G${"O".repeat(55)}`, auditorPubkey: "00",
    bidders: [W, L],
    bids: { [W]: bid("750000000", true), [L]: bid("500000000", true, "900000000") },
    winner: W, winningValue: "750000000", status: "Settled",
    ...overrides,
  };
}

const trace = {
  agents: [], settlement: { operatorReceivedUsdc: 999, refundsUsdc: 0, note: "note" },
} as unknown as DemoTrace;
const useCase = USE_CASES[0]!;

function renderBoth(settlement: VerifiedSettlement) {
  return {
    rail: renderToStaticMarkup(<SettlementRail trace={trace} settlement={settlement} />),
    outcome: renderToStaticMarkup(
      <OutcomePanel useCase={useCase} userValue={1} peers={[{ name: "peer", value: 99 }]} isReal settlement={settlement} />,
    ),
  };
}

const winnerOf = (html: string) => html.match(/data-settlement-winner="([^"]*)"/)?.[1];
const refundsOf = (html: string) => [...html.matchAll(/data-refund="([^"]*)"/g)].map((m) => m[1]);

test("a valid settlement renders the same winner and refund set in both components", () => {
  const settlement = verifySettlement(receipt());
  assert.equal(settlement.state, "verified");
  const { rail, outcome } = renderBoth(settlement);
  assert.equal(winnerOf(rail), W);
  assert.equal(winnerOf(outcome), W);
  assert.deepEqual(refundsOf(rail), [L]);
  assert.deepEqual(refundsOf(outcome), [L]);
  assert.match(rail, /75\.0000 USDC/);
  assert.match(outcome, /75\.0000 USDC/);
  assert.match(rail, /90\.0000 USDC/);
  assert.doesNotMatch(rail, /999/);
});

test("a rejected receipt renders the error code and no winner amount", () => {
  const settlement = verifySettlement(receipt({ winner: L }));
  assert.deepEqual(settlement, { state: "rejected", code: "winner_mismatch" });
  for (const html of Object.values(renderBoth(settlement))) {
    assert.match(html, /winner_mismatch/);
    assert.equal(winnerOf(html), undefined);
    assert.doesNotMatch(html, /USDC<\/strong>|75\.0000|999/);
  }
});

test("a tampered network fingerprint is rejected by the SDK verifier", () => {
  assert.deepEqual(verifySettlement(receipt({ networkFingerprint: "00" })), { state: "rejected", code: "network_mismatch" });
});

test("refund rows match the verified set, including an empty set", () => {
  const settlement = verifySettlement(receipt({ bids: { [W]: bid("750000000", true), [L]: bid("500000000", false) } }));
  assert.equal(settlement.state, "verified");
  const { rail, outcome } = renderBoth(settlement);
  assert.deepEqual(refundsOf(rail), []);
  assert.deepEqual(refundsOf(outcome), []);
  assert.equal(winnerOf(rail), winnerOf(outcome));
});

test("pending verification renders no winner or amounts in either component", () => {
  for (const html of Object.values(renderBoth(PENDING_SETTLEMENT))) {
    assert.match(html, /data-settlement-state="pending"/);
    assert.equal(winnerOf(html), undefined);
    assert.doesNotMatch(html, /peer|999/);
  }
});

test("a verifier that throws yields a rejected result", () => {
  assert.deepEqual(verifySettlement(receipt(), () => { throw new Error("boom"); }), { state: "rejected", code: "verifier_error" });
});

test("a declared winning value that differs from the verified bid is rejected", () => {
  assert.deepEqual(verifySettlement(receipt({ winningValue: "1" })), { state: "rejected", code: "winning_value_mismatch" });
});
