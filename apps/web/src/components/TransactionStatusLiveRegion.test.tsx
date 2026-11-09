// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TransactionStatusLiveRegion,
  buildTransactionAnnouncement,
  redactSealedValues,
} from "./TransactionStatusLiveRegion";
import { RoundStatusBadge } from "./RoundStatusBadge";

const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("TransactionStatusLiveRegion and accessible transaction announcements", () => {
  it("renders a polite atomic live region for commit, reveal, settle, and retry transitions", () => {
    const commitHtml = renderToStaticMarkup(
      <TransactionStatusLiveRegion
        phase="commit"
        status="ok"
        roundId={7n}
        committed={true}
        revealedCount={0}
        sealedValue={1450}
      />,
    );

    assert.match(commitHtml, /role="status"/);
    assert.match(commitHtml, /aria-live="polite"/);
    assert.match(commitHtml, /aria-atomic="true"/);
    assert.match(
      commitHtml,
      /Round #7: Commitment sealed on-chain\. Value remains hidden until reveal\./,
    );
    assert.doesNotMatch(commitHtml, /1450|1,450/);

    const revealProgressMsg = buildTransactionAnnouncement({
      phase: "reveal",
      status: "working",
      roundId: 7n,
      revealProgress: { current: 2, total: 3 },
    });
    assert.equal(revealProgressMsg, "Round #7: Revealing entry 2 of 3.");

    const revealDoneMsg = buildTransactionAnnouncement({
      phase: "reveal",
      status: "ok",
      roundId: 7n,
      revealedCount: 3,
    });
    assert.equal(revealDoneMsg, "Round #7: Reveal complete. 3 entries opened on-chain.");

    const settleMsg = buildTransactionAnnouncement({
      phase: "settle",
      status: "ok",
      roundId: 7n,
      roundStatus: "Settled",
    });
    assert.equal(settleMsg, "Round #7: Round settled on-chain.");

    const retryWorkingMsg = buildTransactionAnnouncement({
      phase: "retry",
      status: "working",
      roundId: 7n,
    });
    assert.equal(retryWorkingMsg, "Round #7: Retrying transaction status sync.");

    const retryErrorMsg = buildTransactionAnnouncement({
      phase: "retry",
      status: "error",
      roundId: 7n,
    });
    assert.equal(retryErrorMsg, "Round #7: Transaction failed. Check wallet and retry.");
  });

  it("never announces sealed bid values or currency amounts before reveal", () => {
    const sanitized = redactSealedValues(
      "Sealed Bid amount: $2,750 USDC (raw 2750)",
      2750,
    );
    assert.doesNotMatch(sanitized, /2750|2,750/);
    assert.match(sanitized, /\[sealed/);

    const errAnnouncement = buildTransactionAnnouncement({
      phase: "idle",
      status: "error",
      roundId: 11n,
      latestMessage: "Commit rejected for 4,200 USDC bid",
      sealedValue: 4200,
    });
    assert.doesNotMatch(errAnnouncement, /4200|4,200/);
  });

  it("renders RoundStatusBadge as a polite live region across loading, error, stale, and found states", () => {
    const errorBadge = renderToStaticMarkup(
      <RoundStatusBadge
        state="error"
        error="RPC timeout"
        onRetry={() => {}}
      />,
    );
    assert.match(errorBadge, /role="status"/);
    assert.match(errorBadge, /aria-live="polite"/);
    assert.match(errorBadge, /aria-atomic="true"/);
    assert.match(errorBadge, /Retry/);
  });

  it("ensures useRoundSession commitEntry does not leak displayed entryValue into toast or log strings", () => {
    const hookSource = readFileSync(
      resolve(WEB_ROOT, "src/hooks/useRoundSession.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      hookSource,
      /Sealing your entry[\s\S]{0,80}displayed/,
      "commit working toast must not announce the sealed bid value",
    );
    assert.doesNotMatch(
      hookSource,
      /push\(`Sealed \$\{active\.inputLabel\}: \$\{displayed\}/,
      "commit log entry must not announce the sealed bid value",
    );
  });
});
