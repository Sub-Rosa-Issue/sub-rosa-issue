// Copyright (c) 2026 Sub Rosa contributors
// ObserverView phase-gating tests.
//
// Acceptance criteria (issue #392):
//   - A commit-phase fixture does not render the fixture bid amount.
//   - A reveal-phase fixture does render it.
//   - Tests render the components without a wallet.
//
// Rendering uses react-dom/server (no wallet, no provider setup beyond the
// injectable fake clock), mirroring RoundStatusBadge.test.tsx conventions.

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeTime } from "@sub-rosa/time";

import { DEMO_TRACE, type DemoTrace } from "../demo/trace";
import { localCountdown } from "../lib/countdown";
import { TimeProvider } from "../lib/time";
import { ObserverView, SEALED_PLACEHOLDER } from "./ObserverView";

/** Fake-clock timestamp just before Drand R publishes (commit phase). */
function commitPhaseNowMs(revealRound: number): number {
  const { targetTime } = localCountdown(revealRound, 0);
  return (targetTime - 1) * 1000;
}

/** Fake-clock timestamp just after Drand R publishes (reveal phase). */
function revealPhaseNowMs(revealRound: number): number {
  const { targetTime } = localCountdown(revealRound, 0);
  return (targetTime + 1) * 1000;
}

/** Trace with a given round status, keeping every other field. */
function traceWithStatus(status: string): DemoTrace {
  return {
    ...DEMO_TRACE,
    meta: { ...DEMO_TRACE.meta, roundStatus: status },
  };
}

function renderObserver(trace: DemoTrace, nowMs: number): string {
  const fake = createFakeTime(nowMs);
  return renderToStaticMarkup(
    <TimeProvider value={fake}>
      <ObserverView trace={trace} live={null} />
    </TimeProvider>,
  );
}

/**
 * Extract only the "Revealed bid" table column so value assertions cannot be
 * satisfied by the public escrow column (fixtures often escrow == bid).
 */
function revealedBidColumn(html: string): string {
  const cells: string[] = [];
  for (const match of html.matchAll(/<td>((?:[^<]|<(?!\/td>))*?)<\/td><td>(?:yes|no|—)<\/td><td>(?:✓)?<\/td><\/tr>/g)) {
    cells.push(match[1]);
  }
  return cells.join("\n");
}

test("commit-phase fixture does not render the fixture bid amount", () => {
  const trace = traceWithStatus("Open");
  const html = renderObserver(trace, commitPhaseNowMs(trace.meta.revealRound));
  const bidColumn = revealedBidColumn(html);

  // Sealed column shows the commitment hash, not the amount…
  assert.match(bidColumn, /H=••••••••••••••••/);
  assert.match(bidColumn, new RegExp(SEALED_PLACEHOLDER));
  // …and no formatted fixture bid value appears in that column.
  for (const bidder of trace.bidders) {
    if (bidder.bidUsdc == null) continue;
    const rendered = bidder.bidUsdc.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    assert.ok(
      !bidColumn.includes(rendered),
      `commit-phase render must not contain bid amount ${rendered}`,
    );
  }
  // Winner is hidden pre-reveal too.
  assert.ok(!html.includes("Winner:"), "winner must stay sealed before reveal");
});

test("reveal-phase fixture renders the revealed bid amounts", () => {
  const trace = traceWithStatus("Settled");
  const html = renderObserver(trace, revealPhaseNowMs(trace.meta.revealRound));
  const bidColumn = revealedBidColumn(html);

  assert.ok(!bidColumn.includes(SEALED_PLACEHOLDER), "settled round must show values");
  for (const bidder of trace.bidders) {
    if (bidder.bidUsdc == null) continue;
    const rendered = bidder.bidUsdc.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    assert.ok(bidColumn.includes(rendered), `reveal-phase render must contain ${rendered}`);
  }
  assert.match(html, /Winner:/);
});

test("winner mark only appears after reveal", () => {
  const commitHtml = renderObserver(
    traceWithStatus("Open"),
    commitPhaseNowMs(DEMO_TRACE.meta.revealRound),
  );
  const revealHtml = renderObserver(
    traceWithStatus("Settled"),
    revealPhaseNowMs(DEMO_TRACE.meta.revealRound),
  );
  assert.ok(!commitHtml.includes("✓"), "winner column stays empty pre-reveal");
  assert.ok(revealHtml.includes("✓"), "winner mark appears post-reveal");
});

test("live bid state without a revealed value stays sealed even post-R", () => {
  const fake = createFakeTime(revealPhaseNowMs(DEMO_TRACE.meta.revealRound));
  const html = renderToStaticMarkup(
    <TimeProvider value={fake}>
      <ObserverView
        trace={DEMO_TRACE}
        live={{
          round: {
            auditor_pubkey: Buffer.alloc(0),
            bidders: DEMO_TRACE.bidders.map((b) => b.address),
            clearing_rule: { tag: "HighestBid", values: undefined },
            commit_deadline: 0n,
            item_ref: Buffer.alloc(0),
            operator: DEMO_TRACE.bidders[0]!.address,
            reveal_deadline: 0n,
            reveal_round: BigInt(DEMO_TRACE.meta.revealRound),
            status: { tag: "Revealing", values: undefined },
            winner: undefined,
            winning_bid: 0n,
          },
          bidders: DEMO_TRACE.bidders.map((b) => b.address),
          bidStates: Object.fromEntries(
            DEMO_TRACE.bidders.map((b) => [
              b.address,
              {
                commitment: Buffer.alloc(32, 9),
                escrow: BigInt(Math.round(b.escrowUsdc * 1e7)),
                revealed_nonce: undefined,
                revealed_value: undefined,
                settled: false,
                valid: false,
              },
            ]),
          ),
          polledAt: fake.clock.nowMs(),
        }}
      />
    </TimeProvider>,
  );

  const bidColumn = revealedBidColumn(html);
  assert.match(bidColumn, /H=0909090909090909…/);
  assert.ok(!bidColumn.includes("700.00"), "live sealed value must stay hidden");
});

test("observer view renders without a wallet", () => {
  const html = renderObserver(DEMO_TRACE, revealPhaseNowMs(DEMO_TRACE.meta.revealRound));
  assert.match(html, /Observer view/);
  assert.doesNotMatch(html, /Freighter/);
});
