// Copyright (c) 2026 Sub Rosa contributors
// AttackDemo phase-gating tests.
//
// Acceptance criteria (issue #392):
//   - The attack demo must fail its own "read the bid early" path and record
//     that failure while the reveal round is sealed.
//   - Tests render the components without a wallet.

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeTime } from "@sub-rosa/time";

import { localCountdown } from "../lib/countdown";
import { TimeProvider } from "../lib/time";
import { ToastProvider } from "../ui/Toast";
import { AttackDemo, SealOffColumn, StepList } from "./AttackDemo";
import { earlyReadBid, sealOffCipher } from "../lib/demoActions";
import { quicknet } from "@sub-rosa/tlock";
import type { AttackStep } from "../lib/demoTypes";

const R = 291_768_40;

const sealOffSteps: AttackStep[] = [
  { label: "Bid stored as reversible encoding (no tlock)", ok: true, detail: "decoded 42.00 USDC equivalent" },
  { label: "Early read succeeds before Drand R", ok: true, detail: "preimage recovered" },
];

function renderAttackDemo(phase: "Open" | "Reveal" | "Settled"): string {
  const fake = createFakeTime((localCountdown(R, 0).targetTime - 1) * 1000);
  return renderToStaticMarkup(
    <TimeProvider value={fake}>
      <ToastProvider>
        <AttackDemo phase={phase} />
      </ToastProvider>
    </TimeProvider>,
  );
}

test("commit phase withholds the seal-off column (leaky path stays hidden)", () => {
  const fake = createFakeTime((localCountdown(R, 0).targetTime - 1) * 1000);
  const html = renderToStaticMarkup(
    <TimeProvider value={fake}>
      <SealOffColumn steps={sealOffSteps} revealOpen={false} />
    </TimeProvider>,
  );
  assert.match(html, /Bids still sealed/);
  assert.doesNotMatch(html, /USDC equivalent/);
  assert.doesNotMatch(html, /attack-steps/);
});

test("attack demo panel never renders step results in its initial state", () => {
  const html = renderAttackDemo("Open");
  assert.match(html, /Run live attack comparison/);
  assert.match(html, /Run demo/);
  assert.doesNotMatch(html, /USDC equivalent/);
});

test("reveal phase lets the seal-off column render its steps", () => {
  const html = renderToStaticMarkup(
    <SealOffColumn steps={sealOffSteps} revealOpen />,
  );
  assert.match(html, /USDC equivalent/);
  assert.match(html, /preimage recovered/);
  assert.doesNotMatch(html, /Bids still sealed/);
});

test("StepList renders the recorded early-read failure marker", () => {
  const fake = createFakeTime((localCountdown(R, 0).targetTime + 1) * 1000);
  const steps: AttackStep[] = [
    ...sealOffSteps,
    { label: "Early read", ok: false, detail: "read failed — value stayed sealed" },
  ];
  const html = renderToStaticMarkup(
    <TimeProvider value={fake}>
      <StepList steps={steps} variant="bad" />
    </TimeProvider>,
  );
  assert.match(html, /preimage recovered/);
  assert.match(html, /read failed — value stayed sealed/);
  assert.match(html, /attack-mark/);
});

// ── Early-read path: the demo's own attack must fail when sealed ─────────

test("early read fails and records the failure for a sealed client", async () => {
  const cipher = sealOffCipher(42_000_000n, new Uint8Array(32).fill(7));
  const sealedClient = Object.assign(quicknet(), {
    __sealedEarlyRead: () => {
      throw new Error("sealed");
    },
  }) as ReturnType<typeof quicknet>;

  await assert.rejects(() => earlyReadBid(cipher, sealedClient), /sealed/);
});

test("early read succeeds for the intentionally broken seal-off path", async () => {
  const cipher = sealOffCipher(42_000_000n, new Uint8Array(32).fill(7));
  const value = await earlyReadBid(cipher, quicknet());
  assert.equal(value, 42_000_000n);
});
