import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DASHBOARD_FIXTURE } from "../../dashboard/fixture";
import type { DashboardData } from "../../dashboard/types";
import { RoundStatusCard } from "./RoundStatusCard";

function renderCard(data: DashboardData): string {
  return renderToStaticMarkup(<RoundStatusCard data={data} />);
}

test("round status card renders settled phase and past Drand countdown", () => {
  const html = renderCard(DASHBOARD_FIXTURE);

  assert.match(html, /Settled/);
  assert.match(html, /Reveal countdown/);
  assert.match(html, /has already published/);
});

test("round status card renders open phase and live countdown copy", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const data: DashboardData = {
    ...DASHBOARD_FIXTURE,
    round: {
      ...DASHBOARD_FIXTURE.round,
      status: "Open",
      commitDeadline: nowSeconds + 60,
      revealDeadline: nowSeconds + 360,
      revealRound: 99_999_999,
      winner: null,
      winningBid: null,
    },
  };

  const html = renderCard(data);

  assert.match(html, /Open/);
  assert.match(html, /until R 99,999,999/);
});

test("round status card renders reveal phase when an open round passed R", () => {
  const data: DashboardData = {
    ...DASHBOARD_FIXTURE,
    round: {
      ...DASHBOARD_FIXTURE.round,
      status: "Open",
      winner: null,
      winningBid: null,
    },
  };

  const html = renderCard(data);

  assert.match(html, /Reveal/);
  assert.match(html, /has already published/);
});
