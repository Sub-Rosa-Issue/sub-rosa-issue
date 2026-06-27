export type UseCaseId = "dao" | "grants" | "auction" | "bounty" | "allocation";

/**
 * inputKind drives the commit form UI for each case while the underlying
 * commit/reveal pipeline stays identical. The numeric `value` is what we
 * actually seal on-chain; everything else is presentation.
 */
export type InputKind = "ballot" | "score" | "amount";

export interface BallotOption {
  value: number;
  label: string;
  helper: string;
  tone: "for" | "against" | "neutral";
}

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

export type OutcomeKind = "tally" | "leaderboard" | "highest" | "distribution";

export interface UseCase {
  id: UseCaseId;
  nav: string;
  tagline: string;
  title: string;
  oneLine: string;
  inputKind: InputKind;
  inputLabel: string;
  defaultValue: number;
  /** ballot only */
  options?: BallotOption[];
  /** score / amount only */
  min?: number;
  max?: number;
  step?: number;
  /** amount only — quick pick chips */
  presets?: number[];
  /** display unit (e.g. "USDC", "/ 10") */
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
  outcomeKind: OutcomeKind;
}

const formatUsdc = (value: number): string =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;

const USE_CASE_DEFINITIONS: UseCase[] = [
  {
    id: "dao",
    nav: "DAO Vote",
    tagline: "Governance",
    title: "Cast a sealed DAO ballot.",
    oneLine: "Ballots stay encrypted to Drand R, then the full tally opens in a single reveal.",
    inputKind: "ballot",
    inputLabel: "your ballot",
    defaultValue: 100,
    actorRole: "voter",
    commitCta: "Cast sealed vote",
    formatValue: (value) => {
      if (value >= 75) return "Yes";
      if (value <= 25) return "No";
      return "Abstain";
    },
    options: [
      {
        value: 100,
        label: "Yes",
        helper: "support the proposal",
        tone: "for",
      },
      {
        value: 50,
        label: "Abstain",
        helper: "no preference recorded",
        tone: "neutral",
      },
      {
        value: 0,
        label: "No",
        helper: "reject the proposal",
        tone: "against",
      },
    ],
    examples: [
      { name: "Member alpha", value: 100, label: "Yes" },
      { name: "Member beta", value: 100, label: "Yes" },
      { name: "Member gamma", value: 0, label: "No" },
    ],
    comparison: {
      leakyTitle: "Visible whip count",
      leakyBody:
        "Late voters watch the running tally and bandwagon onto the leading side.",
      sealedTitle: "Hidden until quorum",
      sealedTitleAfterCommit: "Ballot sealed on-chain",
      sealedBody:
        "Every ballot is encrypted to Drand R; the DAO sees one final tally at reveal.",
    },
    cohort: [
      { name: "Member alpha", value: 100, delayMs: 1200 },
      { name: "Member beta", value: 100, delayMs: 3800 },
      { name: "Member gamma", value: 0, delayMs: 7400 },
      { name: "Member delta", value: 50, delayMs: 11600 },
    ],
    outcomeKind: "tally",
  },
  {
    id: "grants",
    nav: "Grant Allocation",
    tagline: "Grants · SCF-style",
    title: "Run a sealed grant review.",
    oneLine:
      "Judges submit sealed scores; Drand opens the panel together for a verifiable allocation result.",
    inputKind: "score",
    inputLabel: "your score",
    defaultValue: 8,
    min: 0,
    max: 10,
    step: 0.5,
    unit: "/ 10",
    actorRole: "judge",
    commitCta: "Submit sealed score",
    formatValue: (value) =>
      `${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 10`,
    examples: [
      { name: "Judge alpha", value: 8.2, label: "8.2 / 10" },
      { name: "Judge beta", value: 9.1, label: "9.1 / 10" },
      { name: "Judge gamma", value: 7.6, label: "7.6 / 10" },
    ],
    comparison: {
      leakyTitle: "Public leaderboard",
      leakyBody:
        "Early scores anchor the panel. The last judge sees the average and drags toward it.",
      sealedTitle: "Blind panel",
      sealedTitleAfterCommit: "Score sealed on-chain",
      sealedBody:
        "Every judge commits sealed; the keeper opens all scores together at reveal.",
    },
    cohort: [
      { name: "Judge alpha", value: 8.2, delayMs: 1500 },
      { name: "Judge beta", value: 9.1, delayMs: 4200 },
      { name: "Judge gamma", value: 7.6, delayMs: 7800 },
      { name: "Judge delta", value: 8.8, delayMs: 11200 },
    ],
    outcomeKind: "leaderboard",
  },
  {
    id: "auction",
    nav: "Auction",
    tagline: "Sealed auctions",
    title: "Run a sealed auction template.",
    oneLine:
      "Bidders register, lock escrow, reveal after Drand R, and the round settles the highest valid bid deterministically.",
    inputKind: "amount",
    inputLabel: "your bid",
    defaultValue: 1200,
    min: 100,
    max: 10000,
    step: 50,
    presets: [250, 750, 1200, 2500],
    unit: "USDC",
    actorRole: "bidder",
    commitCta: "Seal auction bid",
    formatValue: formatUsdc,
    examples: [
      { name: "Bidder A", value: 1200, label: formatUsdc(1200) },
      { name: "Bidder B", value: 1800, label: formatUsdc(1800) },
      { name: "Bidder C", value: 900, label: formatUsdc(900) },
    ],
    comparison: {
      leakyTitle: "Open bid book",
      leakyBody:
        "Early bidders can react to each visible offer and bid just above the leader.",
      sealedTitle: "Sealed auction",
      sealedTitleAfterCommit: "Bid sealed on-chain",
      sealedBody:
        "Bids are encrypted to Drand R and settled by the existing highest-bid clearing rule.",
    },
    cohort: [
      { name: "Bidder A", value: 1200, delayMs: 1400 },
      { name: "Bidder B", value: 1800, delayMs: 4700 },
      { name: "Bidder C", value: 900, delayMs: 8300 },
      { name: "Bidder D", value: 1500, delayMs: 12100 },
    ],
    outcomeKind: "highest",
  },
  {
    id: "bounty",
    nav: "Bounty Track",
    tagline: "Hackathons",
    title: "Place a sealed bounty bid.",
    oneLine:
      "Bidders cannot see the leading number, so the meta cannot leak before close.",
    inputKind: "amount",
    inputLabel: "your bid",
    defaultValue: 500,
    min: 50,
    max: 5000,
    step: 50,
    presets: [100, 250, 500, 1000],
    unit: "USDC",
    actorRole: "reviewer",
    commitCta: "Lock sealed bid",
    formatValue: formatUsdc,
    examples: [
      { name: "Reviewer alpha", value: 480, label: formatUsdc(480) },
      { name: "Reviewer beta", value: 520, label: formatUsdc(520) },
      { name: "Reviewer gamma", value: 410, label: formatUsdc(410) },
    ],
    comparison: {
      leakyTitle: "Visible meta",
      leakyBody:
        "Teams watch the running leader and copy the winning bid pattern moments before close.",
      sealedTitle: "Closed bid book",
      sealedTitleAfterCommit: "Bid sealed on-chain",
      sealedBody:
        "All bids are encrypted to Drand R; the contract opens them simultaneously.",
    },
    cohort: [
      { name: "Reviewer alpha", value: 480, delayMs: 1300 },
      { name: "Reviewer beta", value: 520, delayMs: 4400 },
      { name: "Reviewer gamma", value: 410, delayMs: 7900 },
      { name: "Reviewer delta", value: 600, delayMs: 11800 },
    ],
    outcomeKind: "highest",
  },
  {
    id: "allocation",
    nav: "Token Allocation",
    tagline: "Distribution",
    title: "Submit a sealed allocation.",
    oneLine:
      "Demand is hidden until R, so participants cannot trade against the visible order book.",
    inputKind: "amount",
    inputLabel: "your allocation",
    defaultValue: 5000,
    min: 100,
    max: 25000,
    step: 100,
    presets: [500, 1500, 5000, 12000],
    unit: "USDC",
    actorRole: "cohort",
    commitCta: "Lock allocation",
    formatValue: formatUsdc,
    examples: [
      { name: "Cohort alpha", value: 5200, label: formatUsdc(5200) },
      { name: "Cohort beta", value: 6650, label: formatUsdc(6650) },
      { name: "Cohort gamma", value: 4400, label: formatUsdc(4400) },
    ],
    comparison: {
      leakyTitle: "Visible demand",
      leakyBody:
        "Participants see the order book forming and trade against the leading allocation.",
      sealedTitle: "One-shot clearing",
      sealedTitleAfterCommit: "Allocation sealed on-chain",
      sealedBody:
        "Demand is sealed until R; clearing uses one public reveal set, no front-running.",
    },
    cohort: [
      { name: "Cohort alpha", value: 5200, delayMs: 1400 },
      { name: "Cohort beta", value: 6650, delayMs: 4600 },
      { name: "Cohort gamma", value: 4400, delayMs: 8200 },
      { name: "Cohort delta", value: 8100, delayMs: 12000 },
    ],
    outcomeKind: "distribution",
  },
];

const USE_CASE_ORDER: UseCaseId[] = ["grants", "auction", "bounty", "allocation", "dao"];

export const USE_CASES: UseCase[] = USE_CASE_ORDER.map((id) =>
  USE_CASE_DEFINITIONS.find((item) => item.id === id),
).filter((item): item is UseCase => item != null);

export function getUseCase(id: UseCaseId) {
  return USE_CASES.find((item) => item.id === id) ?? USE_CASES[0];
}
