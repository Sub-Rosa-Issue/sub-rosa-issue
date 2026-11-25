// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentActivity } from "./AgentPanels";
import { applyCommitOutcome, type AgentCommitStatusMap } from "../lib/agent-commit-status";
import type { DemoTrace } from "../demo/trace";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function agent(name: string, sessionKey: string) {
  return {
    name, principal: sessionKey, sessionKey,
    mandate: { maxBidUsdc: 200, maxEscrowUsdc: 200, maxAppraisalSpendUsdc: 1, cappedAtMaxBid: false },
    appraisal: { fairValue: 50, suggestedMaxBid: 42, inputsHash: "ab".repeat(32) },
    x402: { priceUsdc: 0.1, settled: true },
  };
}
const bidder = (label: string, address: string) =>
  ({ label, address, role: "agent", escrowUsdc: 100, bidUsdc: 42.5, revealed: false, valid: false, winner: false });
const trace = {
  agents: [agent("Alpha", A)],
  bidders: [bidder("Alpha", A)],
} as unknown as DemoTrace;

function render(outcomes?: AgentCommitStatusMap, t: DemoTrace = trace) {
  return renderToStaticMarkup(<AgentActivity trace={t} commitOutcomes={outcomes} />);
}

test("a successful SDK commit fixture shows the committed bid", () => {
  const html = render(applyCommitOutcome({}, { status: "committed", bidder: A }));
  assert.match(html, /data-commit-status="committed"/);
  assert.match(html, /42\.5/);
});

test("a failed SDK commit stays uncommitted and shows the SDK error code", () => {
  const html = render(applyCommitOutcome({}, { status: "failed", bidder: A, code: "SubRosaPreflightError#7" }));
  assert.doesNotMatch(html, /data-commit-status="committed"/);
  assert.match(html, /data-commit-status="failed"/);
  assert.match(html, /SubRosaPreflightError#7/);
  assert.doesNotMatch(html, /42\.5/);
});

test("a pending SDK response stays uncommitted", () => {
  const html = render(applyCommitOutcome({}, { status: "pending", bidder: A }));
  assert.doesNotMatch(html, /data-commit-status="committed"/);
  assert.match(html, /Commit pending/);
  assert.doesNotMatch(html, /42\.5/);
});

test("a later success for a different bidder does not flip this row", () => {
  let rows = applyCommitOutcome({}, { status: "pending", bidder: A });
  rows = applyCommitOutcome(rows, { status: "committed", bidder: B });
  const two = { ...trace, agents: [agent("Alpha", A), agent("Beta", B)], bidders: [bidder("Alpha", A), bidder("Beta", B)] } as unknown as DemoTrace;
  const html = render(rows, two);
  assert.equal(html.match(/data-commit-status="committed"/g)?.length, 1);
  assert.match(html, /Commit pending/);
  assert.deepEqual(rows[A], { status: "pending", bidder: A });
});

test("a failure after a confirmed commit keeps the committed row", () => {
  const rows = applyCommitOutcome(applyCommitOutcome({}, { status: "committed", bidder: A }), { status: "failed", bidder: A, code: "X" });
  assert.equal(rows[A]?.status, "committed");
});

test("without SDK outcomes the replayed trace is committed only when it recorded a commit tx", () => {
  assert.doesNotMatch(render(), /data-commit-status="committed"/);
  const recorded = { ...trace, agents: [{ ...agent("Alpha", A), commitTx: "tx" }] } as unknown as DemoTrace;
  assert.match(render(undefined, recorded), /data-commit-status="committed"/);
});
