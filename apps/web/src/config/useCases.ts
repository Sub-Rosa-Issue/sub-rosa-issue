// Copyright (c) 2026 Sub Rosa contributors
export type UseCaseId = "auction";

export interface CaseExample {
  name: string;
  value: number;
  label: string;
}

export interface Peer {
  name: string;
  value: number;
  /** ms offset from round creation when this peer "commits" their sealed entry */
  delayMs: number;
}

export interface UseCase {
  id: UseCaseId;
  nav: string;
  tagline: string;
  title: string;
  oneLine: string;
  inputLabel: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  /** display unit, e.g. "USDC" */
  unit?: string;
  /** label for the commit CTA — gives every case its own verb */
  commitCta: string;
  /** how to render the value as text in toasts, logs, comparisons */
  formatValue: (value: number) => string;
  /** how to label a participant */
  actorRole: string;
  examples: CaseExample[];
  comparison: {
    leakyTitle: string;
    leakyBody: string;
    sealedTitle: string;
    sealedTitleAfterCommit: string;
    sealedBody: string;
  };
  /** simulated peers that commit during the round to make the demo feel populated */
  cohort: Peer[];
}

const formatUsdc = (value: number): string =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;

const USE_CASE_DEFINITIONS: UseCase[] = [
  {
    id: "auction",
    nav: "Sealed Auction",
    tagline: "Auction settlement",
    title: "Run a sealed auction.",
    oneLine:
      "Bidders lock escrow, bids stay hidden until Drand R, and Soroban settles the winner and refunds losers.",
    inputLabel: "your bid",
    defaultValue: 500,
    min: 50,
    max: 5000,
    step: 50,
    presets: [100, 250, 500, 1000],
    unit: "USDC",
    actorRole: "bidder",
    commitCta: "Lock sealed bid",
    formatValue: formatUsdc,
    examples: [
      { name: "Bidder alpha", value: 480, label: formatUsdc(480) },
      { name: "Bidder beta", value: 520, label: formatUsdc(520) },
      { name: "Bidder gamma", value: 410, label: formatUsdc(410) },
    ],
    comparison: {
      leakyTitle: "Visible bid book",
      leakyBody:
        "Late bidders watch the current clearing price and shade their bids moments before close.",
      sealedTitle: "Sealed bid book",
      sealedTitleAfterCommit: "Bid sealed on-chain",
      sealedBody:
        "All bids are encrypted to Drand R; the contract opens them together, clears, settles, and refunds.",
    },
    cohort: [
      { name: "Bidder alpha", value: 480, delayMs: 1300 },
      { name: "Bidder beta", value: 520, delayMs: 4400 },
      { name: "Bidder gamma", value: 410, delayMs: 7900 },
      { name: "Bidder delta", value: 600, delayMs: 11800 },
    ],
  },
];

const USE_CASE_ORDER: UseCaseId[] = ["auction"];

export const USE_CASES: UseCase[] = USE_CASE_ORDER.map((id) =>
  USE_CASE_DEFINITIONS.find((item) => item.id === id),
).filter((item): item is UseCase => item != null);

export function getUseCase(id: UseCaseId) {
  return USE_CASES.find((item) => item.id === id) ?? USE_CASES[0];
}
