// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TransactionStatusAnnouncer,
  formatTransactionAnnouncement,
  sanitizeSealedAnnouncement,
} from "./TransactionStatusAnnouncer";

const COMPONENTS_DIR = dirname(fileURLToPath(import.meta.url));

function readWebSource(relPath: string): string {
  return readFileSync(resolve(COMPONENTS_DIR, "..", relPath), "utf8");
}

test("TransactionStatusAnnouncer renders a polite atomic live region", () => {
  const html = renderToStaticMarkup(
    <TransactionStatusAnnouncer
      action="commit"
      state="working"
      roundId={7n}
      revealed={false}
    />,
  );

  assert.match(html, /class="tx-status-announcer"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(
    html,
    /Submitting sealed commitment for round #7 — bid value hidden until Drand reveal\./,
  );
});

test("formatTransactionAnnouncement covers commit, reveal, settle, and retry transitions without leaking sealed values", () => {
  const commitOk = formatTransactionAnnouncement({
    action: "commit",
    state: "ok",
    roundId: 42n,
    revealed: false,
    detail: "Bid: 1,250 USDC locked",
  });
  assert.match(commitOk, /Commitment recorded on-chain for round #42/);
  assert.doesNotMatch(commitOk, /1,250/);
  assert.doesNotMatch(commitOk, /USDC/);

  const commitErr = formatTransactionAnnouncement({
    action: "commit",
    state: "error",
    roundId: 42n,
    revealed: false,
    detail: "Escrow: 500 XLM rejected by simulation",
  });
  assert.match(commitErr, /Commit failed for round #42: \[sealed value\] rejected by simulation/);
  assert.doesNotMatch(commitErr, /500 XLM/);

  const revealWorking = formatTransactionAnnouncement({
    action: "reveal",
    state: "working",
    roundId: 42n,
    revealProgress: { current: 2, total: 3 },
  });
  assert.equal(revealWorking, "Revealing bid 2 of 3 for round #42…");

  const revealOk = formatTransactionAnnouncement({
    action: "reveal",
    state: "ok",
    roundId: 42n,
    revealed: true,
    revealedCount: 3,
  });
  assert.equal(revealOk, "Reveal complete for round #42 — 3 entries opened on-chain.");

  const settleWorking = formatTransactionAnnouncement({
    action: "settle",
    state: "working",
    roundId: 42n,
  });
  assert.equal(settleWorking, "Submitting settlement transaction for round #42…");

  const settleOk = formatTransactionAnnouncement({
    action: "settle",
    state: "ok",
    roundId: 42n,
  });
  assert.equal(settleOk, "Settlement complete on-chain for round #42.");

  const retryWorking = formatTransactionAnnouncement({
    action: "retry",
    state: "working",
    roundId: 42n,
  });
  assert.equal(retryWorking, "Retrying status check for round #42…");

  const retryErr = formatTransactionAnnouncement({
    action: "retry",
    state: "error",
    roundId: 42n,
  });
  assert.equal(retryErr, "Retry failed for round #42 — try again.");
});

test("sanitizeSealedAnnouncement strips bid/escrow amounts before reveal and preserves public copy after reveal", () => {
  const preReveal = sanitizeSealedAnnouncement(
    "Sealed Bid: $420 and 420 USDC escrow locked",
    { revealed: false },
  );
  assert.doesNotMatch(preReveal, /420/);
  assert.doesNotMatch(preReveal, /USDC/);
  assert.match(preReveal, /\[sealed value\]/);

  const postReveal = sanitizeSealedAnnouncement(
    "Winner settled for 420 USDC",
    { revealed: true },
  );
  assert.equal(postReveal, "Winner settled for 420 USDC");
});

test("useRoundSession and DemoPage do not announce plaintext bid values while round is sealed", () => {
  const sessionSource = readWebSource("hooks/useRoundSession.ts");
  const demoSource = readWebSource("pages/DemoPage.tsx");

  assert.doesNotMatch(
    sessionSource,
    /Sealing your entry….*inputLabel/,
    "commitEntry working toast must not interpolate the unrevealed bid value",
  );
  assert.doesNotMatch(
    sessionSource,
    /push\(`Sealed \$\{active\.inputLabel\}/,
    "commitEntry log must not record the plaintext bid value before reveal",
  );
  assert.match(demoSource, /<TransactionStatusAnnouncer/);
  assert.match(demoSource, /"Sealed until R"/);
  assert.match(demoSource, /className=\{`tx-log \$\{status\}`\} role="log" aria-live="polite"/);
});
