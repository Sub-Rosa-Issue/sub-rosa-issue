import { normalizeError } from "@sub-rosa/logging/errors";
// SPDX-License-Identifier: MIT
import {
  Account,
  Address,
  Asset,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { BidState, GlobalConfig, Round, Status } from "@sub-rosa/round-bindings";

import type { SubRosaClient } from "./client.js";
import {
  DEPLOYMENT_CHECK_IDS,
  DEPLOYMENT_FIELDS,
  DEPLOYMENT_FIELD_LABELS,
  MAINNET_DEPLOY_MIN_XLM_STROOPS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_MANIFEST,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_MIN_FEE_RESERVE_STROOPS,
  type DeploymentField,
  type MainnetManifest,
} from "./mainnet-artifacts.js";
import { SubRosaDeploymentMismatchError } from "./errors.js";
import { networkFingerprint } from "./receipt.js";

export type ReadinessStatus = "pass" | "warn" | "block";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  message: string;
}

/**
 * Deployment identity read from the network (or replayed from a recorded
 * fixture). `null` means the field could not be read, which is a failure — an
 * unverifiable field must never read as a pass.
 */
export interface MainnetLiveDeployment {
  contractId: string | null;
  networkPassphrase: string | null;
  wasmHash: string | null;
  tokenContract: string | null;
  /** Normalized reason a field could not be read, keyed by field. */
  unreadable?: Partial<Record<DeploymentField, string>>;
}

export interface DeploymentFieldComparison {
  field: DeploymentField;
  label: string;
  /** Redacted manifest value, safe to log. */
  expected: string;
  /** Redacted live value, or null when the field could not be read. */
  actual: string | null;
  ok: boolean;
  /** True when the field could not be read (treated as a failure, not a pass). */
  unreadable: boolean;
}

export interface DeploymentComparison {
  fields: DeploymentFieldComparison[];
  /** Fields whose value is present but different. */
  mismatched: DeploymentFieldComparison[];
  /** Fields that could not be read at all. */
  unreadable: DeploymentFieldComparison[];
  matched: boolean;
  /** Comma-separated field names, for logs and error messages. */
  mismatchedFieldNames: string;
}

export interface MainnetFixtureBid {
  escrow: string;
  revealedValue: string | null;
  valid: boolean;
  settled: boolean;
}

export interface MainnetFixtureRound {
  roundId: string;
  status: string;
  revealRound: string;
  bidders: string[];
  bid: MainnetFixtureBid;
}

/**
 * A recorded mainnet snapshot. Replaying one runs the exact same comparison as
 * a live read, so CI can prove the strict check fails closed without touching a
 * mainnet RPC or any secret.
 */
export interface MainnetReadinessFixture {
  networkPassphrase: string;
  contractId: string;
  wasmHash: string;
  tokenContract: string;
  /** Ledger the recording came from, for context only. */
  ledger?: number;
  /** Recorded contract escrow balance in stroops. */
  contractBalance?: string;
  round: MainnetFixtureRound;
}

export interface MainnetReadinessInput {
  /** The committed manifest. Source of truth for every expected value. */
  manifest: MainnetManifest;
  /** Where the manifest came from (path), echoed in the report. */
  manifestSource?: string;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  live?: boolean;
  /** Recorded deployment metadata. When set, no RPC call is made. */
  fixture?: MainnetReadinessFixture;
  /** When true, include optional balance checks when account ids are provided. */
  withBalances?: boolean;
  tokenSacId?: string;
  operatorAccount?: string;
  keeperAccount?: string;
  bidderAccount?: string;
}

export type ReadinessReader = Pick<
  SubRosaClient,
  "getRound" | "getBidState" | "getBidders" | "getConfig"
> &
  Partial<Pick<SubRosaClient, "contractId" | "networkPassphrase">>;

export interface MainnetReadinessDeps {
  reader?: ReadinessReader;
  rpc?: Pick<
    rpc.Server,
    | "getHealth"
    | "getLatestLedger"
    | "getLedgerEntries"
    | "getAccountEntry"
    | "getNetwork"
    | "simulateTransaction"
  >;
  sacBalance?: (address: string) => Promise<bigint>;
  fetchWasmHash?: (contractId: string) => Promise<string>;
}

export interface MainnetReadinessReport {
  mode: "dry-run" | "fixture" | "live";
  checks: ReadinessCheck[];
  passCount: number;
  warnCount: number;
  blockCount: number;
  /** Live-or-fixture deployment compared against the manifest. */
  deployment?: DeploymentComparison;
  manifestSource?: string;
}

const check = (
  id: string,
  label: string,
  status: ReadinessStatus,
  message: string,
): ReadinessCheck => ({ id, label, status, message });

/** Stellar secret keys are S… + 55 base32 chars. Never echo one. */
const SECRET_KEY_RE = /^S[A-Z2-7]{55}$/i;

/**
 * Render a value for a report or log line. Contract ids and wasm hashes are
 * public identifiers and print in full; a passphrase is reduced to a short
 * fingerprint, and anything shaped like a secret key is redacted outright.
 */
export function summarizeDeploymentValue(
  field: DeploymentField,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined) return "<unread>";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "<empty>";
  if (SECRET_KEY_RE.test(trimmed)) return "<redacted: secret-key-like>";
  if (field === "networkPassphrase") {
    return `passphrase fingerprint ${fingerprint(trimmed)}`;
  }
  return trimmed;
}

function fingerprint(value: string): string {
  return networkFingerprint(value).slice(0, 12);
}

function sameValue(field: DeploymentField, a: string, b: string): boolean {
  if (field === "wasmHash") return a.toLowerCase() === b.toLowerCase();
  if (field === "contractId" || field === "tokenContract") {
    return a.toUpperCase() === b.toUpperCase();
  }
  return a.trim() === b.trim();
}

/**
 * Compare the four deployment identity fields against the committed manifest.
 * Pure: no RPC, no I/O, so it is the same code path in CI and on a laptop.
 */
export function compareDeployment(
  manifest: MainnetManifest,
  live: MainnetLiveDeployment,
): DeploymentComparison {
  const fields: DeploymentFieldComparison[] = DEPLOYMENT_FIELDS.map((field) => {
    const expected = manifest[field] ?? "";
    const raw = live[field];
    const present = typeof raw === "string" && raw.trim().length > 0;
    const unreadable = !present;
    return {
      field,
      label: DEPLOYMENT_FIELD_LABELS[field],
      expected: summarizeDeploymentValue(field, expected),
      actual: present ? summarizeDeploymentValue(field, raw) : null,
      ok: present && sameValue(field, expected, raw as string),
      unreadable,
    };
  });

  const mismatched = fields.filter((f) => !f.ok && !f.unreadable);
  const unreadable = fields.filter((f) => f.unreadable);
  return {
    fields,
    mismatched,
    unreadable,
    matched: mismatched.length === 0 && unreadable.length === 0,
    mismatchedFieldNames: [...mismatched, ...unreadable]
      .map((f) => f.field)
      .join(", "),
  };
}

function comparisonDetail(comparison: DeploymentFieldComparison): string {
  return comparison.unreadable
    ? `${DEPLOYMENT_FIELD_LABELS[comparison.field]} could not be read from the deployment (manifest expects ${comparison.expected})`
    : `${DEPLOYMENT_FIELD_LABELS[comparison.field]} disagrees with the committed manifest: manifest ${comparison.expected}, deployment ${comparison.actual}`;
}

/**
 * Turn a comparison into the four blocking readiness checks. Every disagreement
 * blocks, including a field that could not be read at all.
 */
export function deploymentChecks(
  manifest: MainnetManifest,
  live: MainnetLiveDeployment,
): { checks: ReadinessCheck[]; comparison: DeploymentComparison } {
  const comparison = compareDeployment(manifest, live);
  const checks = comparison.fields.map((field) =>
    check(
      DEPLOYMENT_CHECK_IDS[field.field],
      field.label,
      field.ok ? "pass" : "block",
      field.ok
        ? `matches the committed manifest (${field.expected})`
        : comparisonDetail(field),
    ),
  );
  return { checks, comparison };
}

/** Throw when the live deployment disagrees with the committed manifest. */
export function assertDeploymentMatches(
  manifest: MainnetManifest,
  live: MainnetLiveDeployment,
  manifestSource?: string,
): DeploymentComparison {
  const comparison = compareDeployment(manifest, live);
  if (comparison.matched) return comparison;
  const bad = [...comparison.mismatched, ...comparison.unreadable];
  throw new SubRosaDeploymentMismatchError({
    fields: bad.map((f) => f.field),
    details: bad.map(comparisonDetail),
    manifestSource,
  });
}

export function nativeXlmSacId(networkPassphrase: string): string {
  return Asset.native().contractId(networkPassphrase);
}

export function assertMainnetConfirmed(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.MAINNET_CONFIRM?.trim() !== MAINNET_CONFIRM_PHRASE) {
    throw new Error(
      `set MAINNET_CONFIRM=${MAINNET_CONFIRM_PHRASE} to execute value-moving mainnet commands`,
    );
  }
}

export function assertMicroAmounts(
  bid: bigint,
  escrow: bigint,
  maxEscrow: bigint = MAINNET_MICRO_MAX_ESCROW,
): void {
  if (bid <= 0n || escrow <= 0n) {
    throw new Error("bid and escrow must be positive stroop amounts");
  }
  if (bid > escrow) {
    throw new Error("bid cannot exceed escrow");
  }
  if (escrow > maxEscrow) {
    throw new Error(
      `escrow ${escrow} exceeds MAINNET_MICRO_MAX_ESCROW (${maxEscrow})`,
    );
  }
}

/**
 * Parse an optional micro-runner amount from the environment.
 *
 * Returns `fallback` when unset/blank and refuses values that are not plain
 * positive integer stroops (e.g. `1.5`, `1e3`, `0x10`, `-1`) or that exceed the
 * committed escrow cap. Kept pure so it can be unit-tested without env access.
 */
export function parseMicroStroops(
  name: string,
  raw: string | undefined,
  fallback: bigint,
  maxEscrow: bigint = MAINNET_MICRO_MAX_ESCROW,
): bigint {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${name} must be an integer stroop amount, got ${JSON.stringify(raw)}`,
    );
  }
  const value = BigInt(trimmed);
  if (value <= 0n) {
    throw new Error(`${name} must be a positive stroop amount`);
  }
  if (value > maxEscrow) {
    throw new Error(
      `${name}=${value} exceeds MAINNET_MICRO_MAX_ESCROW (${maxEscrow})`,
    );
  }
  return value;
}

export type MicroRunAction = "dry-run" | "send";

export interface MicroRunDecision {
  action: MicroRunAction;
  bidStroops: bigint;
  escrowStroops: bigint;
}

export interface MicroRunnerGateDeps {
  /** Explicit `--execute` flag. Without it the runner defaults to dry-run. */
  execute: boolean;
  bidStroops: bigint;
  escrowStroops: bigint;
  /** Strict readiness checks. Only invoked for a real send. */
  runReadiness: () => Promise<ReadinessCheck[]>;
  /** Builds and submits on-chain work. Only invoked once the gate passes. */
  submit: () => Promise<void>;
  /** Env used for the confirmation phrase; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Override the escrow ceiling (tests). */
  maxEscrowStroops?: bigint;
}

/**
 * Single gate in front of the mainnet micro runner.
 *
 * Ordering is deliberate so a broadcast can never happen unless every
 * precondition holds:
 *   1. amounts are positive integer stroops within the committed cap,
 *   2. `MAINNET_CONFIRM` is set (send path only),
 *   3. the strict readiness checks pass,
 *   4. only then is `submit` invoked.
 *
 * Dry-run short-circuits before readiness, so it stays offline and never asks
 * for a secret. `runReadiness` and `submit` are injected so the gate can be
 * unit-tested without touching mainnet.
 */
export async function runMicroRunnerGate(
  deps: MicroRunnerGateDeps,
): Promise<MicroRunDecision> {
  const maxEscrow = deps.maxEscrowStroops ?? MAINNET_MICRO_MAX_ESCROW;
  assertMicroAmounts(deps.bidStroops, deps.escrowStroops, maxEscrow);

  const decision: MicroRunDecision = {
    action: "dry-run",
    bidStroops: deps.bidStroops,
    escrowStroops: deps.escrowStroops,
  };

  if (!deps.execute) {
    return decision;
  }

  assertMainnetConfirmed(deps.env);

  const checks = await deps.runReadiness();
  assertReadinessForExecute(checks);

  await deps.submit();

  return { ...decision, action: "send" };
}

export function hasBlockingFailures(checks: ReadinessCheck[]): boolean {
  return checks.some((c) => c.status === "block");
}

export function assertReadinessForExecute(checks: ReadinessCheck[]): void {
  const blocked = checks.filter((c) => c.status === "block");
  if (blocked.length === 0) return;
  const summary = blocked.map((c) => `${c.id}: ${c.message}`).join("; ");
  throw new Error(`mainnet readiness blocked: ${summary}`);
}

export function formatReadinessReport(report: MainnetReadinessReport): string {
  const lines = [
    "Sub Rosa — mainnet launch readiness (read-only)",
    `Mode: ${report.mode}`,
  ];
  if (report.manifestSource) lines.push(`Manifest: ${report.manifestSource}`);
  lines.push("");
  for (const c of report.checks) {
    const tag =
      c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "BLOCK";
    lines.push(`[${tag}] ${c.label}: ${c.message}`);
  }
  if (report.deployment && !report.deployment.matched) {
    lines.push("");
    lines.push(
      `Mismatched deployment fields: ${report.deployment.mismatchedFieldNames || "none"}`,
    );
  }
  lines.push("");
  lines.push(
    `Summary: ${report.passCount} pass, ${report.warnCount} warn, ${report.blockCount} block`,
  );
  return lines.join("\n");
}

export async function fetchContractWasmHash(
  server: Pick<rpc.Server, "getLedgerEntries">,
  contractId: string,
): Promise<string> {
  const contractLedgerKey = new Contract(contractId).getFootprint();
  const response = await server.getLedgerEntries(contractLedgerKey);
  const entry = response.entries[0]?.val;
  if (!entry) {
    throw new Error("contract not found on network");
  }
  const wasmHash = entry
    .contractData()
    .val()
    .instance()
    .executable()
    .wasmHash();
  return Buffer.from(wasmHash).toString("hex");
}

export function createSacBalanceReader(
  rpcUrl: string,
  networkPassphrase: string,
  tokenSacId: string,
  sourcePublicKey: string,
): (address: string) => Promise<bigint> {
  const server = new rpc.Server(rpcUrl);
  const sac = new Contract(tokenSacId);
  return async (address: string): Promise<bigint> => {
    const source = new Account(sourcePublicKey, "0");
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(sac.call("balance", new Address(address).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`balance simulation failed: ${sim.error}`);
    }
    if (!sim.result) return 0n;
    return scValToNative(sim.result.retval) as bigint;
  };
}

export async function verifySettledRoundProof(
  reader: Pick<SubRosaClient, "getRound" | "getBidState" | "getBidders">,
  roundId: bigint,
  expected: {
    bidStroops: bigint;
    escrowStroops: bigint;
    revealRound: number;
  },
): Promise<void> {
  const round = await reader.getRound(roundId);
  const bidders = await reader.getBidders(roundId);
  if (bidders.length !== 1) {
    throw new Error(`expected 1 bidder, got ${bidders.length}`);
  }
  const bidState = await reader.getBidState(roundId, bidders[0]!);
  if (round.status.tag !== "Settled") {
    throw new Error(`status ${round.status.tag} != Settled`);
  }
  if (Number(round.reveal_round) !== expected.revealRound) {
    throw new Error(
      `R ${round.reveal_round} != expected ${expected.revealRound}`,
    );
  }
  if (bidState.revealed_value !== expected.bidStroops) {
    throw new Error(
      `revealed ${bidState.revealed_value} != expected ${expected.bidStroops}`,
    );
  }
  if (bidState.escrow !== expected.escrowStroops) {
    throw new Error(`escrow ${bidState.escrow} != expected ${expected.escrowStroops}`);
  }
  if (!bidState.valid || !bidState.settled) {
    throw new Error("bid not valid/settled");
  }
}

function fixtureStatus(tag: string): Status {
  // Keep the recorded tag verbatim so a mismatched or mistyped fixture status
  // shows up in the report instead of being coerced into a lifecycle state.
  return { tag, values: undefined } as unknown as Status;
}

class FixtureFieldError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`mainnet fixture field ${field} is invalid: ${detail}`);
    this.name = "FixtureFieldError";
    this.field = field;
  }
}

function fixtureString(
  raw: Record<string, unknown>,
  field: string,
): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FixtureFieldError(field, "expected a non-empty string");
  }
  return value.trim();
}

function fixtureBigIntString(
  raw: Record<string, unknown>,
  field: string,
): string {
  const value = fixtureString(raw, field);
  if (!/^\d+$/.test(value)) {
    throw new FixtureFieldError(field, "expected a decimal integer string");
  }
  return value;
}

function fixtureRecord(
  raw: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FixtureFieldError(field, "expected an object");
  }
  return raw as Record<string, unknown>;
}

function fixtureBoolean(
  raw: Record<string, unknown>,
  field: string,
): boolean {
  const value = raw[field];
  if (typeof value !== "boolean") {
    throw new FixtureFieldError(field, "expected true or false");
  }
  return value;
}

/**
 * Validate a recorded fixture. A fixture is test data, so it gets the same
 * closed-schema treatment as the manifest: an unreadable field is a load error
 * rather than a check that quietly passes.
 */
export function parseMainnetReadinessFixture(raw: unknown): MainnetReadinessFixture {
  const record = fixtureRecord(raw, "<root>");
  const round = fixtureRecord(record["round"], "round");
  const bid = fixtureRecord(round["bid"], "round.bid");
  const revealedValue = bid["revealedValue"];
  if (revealedValue !== null && typeof revealedValue !== "string") {
    throw new FixtureFieldError("round.bid.revealedValue", "expected a string or null");
  }
  const bidders = round["bidders"];
  if (!Array.isArray(bidders) || bidders.length === 0) {
    throw new FixtureFieldError("round.bidders", "expected a non-empty array");
  }
  for (const [index, bidder] of bidders.entries()) {
    if (typeof bidder !== "string" || bidder.trim().length === 0) {
      throw new FixtureFieldError(
        `round.bidders[${index}]`,
        "expected a non-empty string",
      );
    }
  }
  const ledger = record["ledger"];
  if (ledger !== undefined && !Number.isSafeInteger(ledger as number)) {
    throw new FixtureFieldError("ledger", "expected a ledger sequence number");
  }
  const contractBalance = record["contractBalance"];
  if (contractBalance !== undefined) {
    if (typeof contractBalance !== "string" || !/^\d+$/.test(contractBalance)) {
      throw new FixtureFieldError(
        "contractBalance",
        "expected a decimal integer string in stroops",
      );
    }
  }

  return {
    networkPassphrase: fixtureString(record, "networkPassphrase"),
    contractId: fixtureString(record, "contractId"),
    wasmHash: fixtureString(record, "wasmHash"),
    tokenContract: fixtureString(record, "tokenContract"),
    ...(ledger === undefined ? {} : { ledger: ledger as number }),
    ...(contractBalance === undefined
      ? {}
      : { contractBalance: contractBalance as string }),
    round: {
      roundId: fixtureBigIntString(round, "roundId"),
      status: fixtureString(round, "status"),
      revealRound: fixtureBigIntString(round, "revealRound"),
      bidders: bidders.map((b) => String(b).trim()),
      bid: {
        escrow: fixtureBigIntString(bid, "escrow"),
        revealedValue:
          revealedValue === null ? null : String(revealedValue).trim(),
        valid: fixtureBoolean(bid, "valid"),
        settled: fixtureBoolean(bid, "settled"),
      },
    },
  };
}

/** Build a read-only client over a recorded fixture. No RPC, no signing. */
export function fixtureReader(
  fixture: MainnetReadinessFixture,
): ReadinessReader {
  const round = {
    auditor_pubkey: Buffer.alloc(32),
    bidders: fixture.round.bidders,
    clearing_rule: { tag: "HighestBid", values: undefined },
    commit_deadline: 0n,
    item_ref: Buffer.alloc(32),
    operator: fixture.round.bidders[0] ?? "GOPERATOR",
    reveal_deadline: 0n,
    reveal_round: BigInt(fixture.round.revealRound),
    status: fixtureStatus(fixture.round.status),
    winner: fixture.round.bidders[0] ?? null,
    winning_bid: fixture.round.bid.revealedValue
      ? BigInt(fixture.round.bid.revealedValue)
      : 0n,
  } as unknown as Round;

  const bidState = {
    commitment: Buffer.alloc(32),
    escrow: BigInt(fixture.round.bid.escrow),
    revealed_nonce: Buffer.alloc(32),
    revealed_value: fixture.round.bid.revealedValue
      ? BigInt(fixture.round.bid.revealedValue)
      : undefined,
    settled: fixture.round.bid.settled,
    valid: fixture.round.bid.valid,
  } as unknown as BidState;

  return {
    contractId: fixture.contractId,
    networkPassphrase: fixture.networkPassphrase,
    getConfig: async () =>
      ({ usdc: fixture.tokenContract }) as unknown as GlobalConfig,
    getRound: async (roundId) => {
      if (BigInt(roundId) !== BigInt(fixture.round.roundId)) {
        throw new Error(
          `round ${roundId.toString()} is not in the recorded fixture`,
        );
      }
      return round;
    },
    getBidders: async (roundId) => {
      if (BigInt(roundId) !== BigInt(fixture.round.roundId)) {
        throw new Error(
          `round ${roundId.toString()} is not in the recorded fixture`,
        );
      }
      return [...fixture.round.bidders];
    },
    getBidState: async (roundId) => {
      if (BigInt(roundId) !== BigInt(fixture.round.roundId)) {
        throw new Error(
          `round ${roundId.toString()} is not in the recorded fixture`,
        );
      }
      return bidState;
    },
  };
}

/** Read a recorded snapshot as if it had been read from the network. */
export function fixtureDeployment(
  fixture: MainnetReadinessFixture,
): MainnetLiveDeployment {
  return {
    contractId: fixture.contractId,
    networkPassphrase: fixture.networkPassphrase,
    wasmHash: fixture.wasmHash,
    tokenContract: fixture.tokenContract,
  };
}

/**
 * Read the deployment identity through the read-only client and the RPC. Each
 * field is read independently so one failure still reports the other three.
 */
export async function readLiveDeployment(
  reader: ReadinessReader,
  rpcServer: Pick<rpc.Server, "getNetwork">,
  contractId: string,
  fetchWasmHash: (contractId: string) => Promise<string>,
): Promise<MainnetLiveDeployment> {
  const unreadable: Partial<Record<DeploymentField, string>> = {};
  const [networkResult, wasmResult, configResult] = await Promise.allSettled([
    rpcServer.getNetwork(),
    fetchWasmHash(contractId),
    reader.getConfig(),
  ]);

  const networkPassphrase =
    networkResult.status === "fulfilled"
      ? networkResult.value.passphrase
      : null;
  if (networkResult.status === "rejected") {
    unreadable.networkPassphrase = normalizeError(networkResult.reason).message;
  }

  const wasmHash = wasmResult.status === "fulfilled" ? wasmResult.value : null;
  if (wasmResult.status === "rejected") {
    unreadable.wasmHash = normalizeError(wasmResult.reason).message;
  }

  const config = configResult.status === "fulfilled" ? configResult.value : null;
  const tokenContract =
    config && typeof config.usdc === "string" && config.usdc.trim().length > 0
      ? config.usdc
      : null;
  if (configResult.status === "rejected") {
    unreadable.tokenContract = normalizeError(configResult.reason).message;
  } else if (config && tokenContract === null) {
    unreadable.tokenContract = "the deployed contract reports no escrow token address";
  }

  return {
    contractId: reader.contractId ?? contractId,
    networkPassphrase,
    wasmHash,
    tokenContract,
    unreadable,
  };
}

function summarize(checks: ReadinessCheck[]): Omit<
  MainnetReadinessReport,
  "mode" | "checks" | "deployment" | "manifestSource"
> {
  return {
    passCount: checks.filter((c) => c.status === "pass").length,
    warnCount: checks.filter((c) => c.status === "warn").length,
    blockCount: checks.filter((c) => c.status === "block").length,
  };
}

/** Configured values must agree with the manifest before anything is read. */
function configChecks(
  input: MainnetReadinessInput,
): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const passphraseOk =
    input.networkPassphrase.trim() === input.manifest.networkPassphrase;
  checks.push(
    check(
      "config-network-passphrase",
      "Configured network passphrase",
      passphraseOk ? "pass" : "block",
      passphraseOk
        ? `${summarizeDeploymentValue("networkPassphrase", input.networkPassphrase)} matches the committed manifest`
        : `configured passphrase (${summarizeDeploymentValue("networkPassphrase", input.networkPassphrase)}) is not the passphrase the committed manifest pins — a green check here would be a check against the wrong network`,
    ),
  );

  const contractOk =
    input.contractId.trim().toUpperCase() ===
    input.manifest.contractId.toUpperCase();
  checks.push(
    check(
      "config-contract-id",
      "Configured contract id",
      contractOk ? "pass" : "block",
      contractOk
        ? `${input.contractId} matches the committed manifest`
        : `configured contract ${input.contractId} is not the contract the committed manifest pins (${input.manifest.contractId})`,
    ),
  );
  return checks;
}

function rpcUrlCheck(rpcUrl: string): ReadinessCheck {
  if (/^https:\/\//i.test(rpcUrl)) {
    return check("rpc-url", "RPC URL", "pass", `uses HTTPS (${rpcUrl})`);
  }
  if (/^http:\/\//i.test(rpcUrl)) {
    return check(
      "rpc-url",
      "RPC URL",
      "warn",
      "uses HTTP — prefer HTTPS for mainnet",
    );
  }
  return check(
    "rpc-url",
    "RPC URL",
    "block",
    `invalid RPC URL ${JSON.stringify(rpcUrl)}`,
  );
}

export async function runMainnetReadiness(
  input: MainnetReadinessInput,
  deps: MainnetReadinessDeps = {},
): Promise<MainnetReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const manifest = input.manifest;
  const fixture = input.fixture;
  const live = fixture ? true : (input.live ?? true);

  checks.push(
    check(
      "manifest-source",
      "Committed artifact manifest",
      "pass",
      input.manifestSource
        ? `loaded ${input.manifestSource} (${manifest.contractId} @ ${manifest.network})`
        : `built-in manifest for ${manifest.contractId} (${manifest.network})`,
    ),
  );
  checks.push(...configChecks(input));
  checks.push(rpcUrlCheck(input.rpcUrl));

  if (!live) {
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "warn",
        "dry-run — would ping RPC health",
      ),
    );
    for (const field of DEPLOYMENT_FIELDS) {
      checks.push(
        check(
          DEPLOYMENT_CHECK_IDS[field],
          DEPLOYMENT_FIELD_LABELS[field],
          "warn",
          `dry-run — would compare the live ${DEPLOYMENT_FIELD_LABELS[field].toLowerCase()} against the committed manifest`,
        ),
      );
    }
    checks.push(
      check(
        "settled-round",
        "Settled round proof",
        "warn",
        `dry-run — would verify round ${manifest.settledRoundId.toString()}`,
      ),
    );
    if (input.withBalances) {
      checks.push(
        check(
          "contract-balance",
          "Contract escrow balance",
          "warn",
          "dry-run — would assert contract token balance is 0",
        ),
      );
    }
    return {
      mode: "dry-run",
      checks,
      manifestSource: input.manifestSource,
      ...summarize(checks),
    };
  }

  const expectedRound = {
    bidStroops: manifest.bidStroops,
    escrowStroops: manifest.escrowStroops,
    revealRound: Number(manifest.revealRound),
  };

  // ── Recorded fixture: same comparison, no mainnet RPC ────────────────────
  if (fixture) {
    const { checks: deployment, comparison } = deploymentChecks(
      manifest,
      fixtureDeployment(fixture),
    );
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "pass",
        fixture.ledger === undefined
          ? "fixture mode — recorded deployment, no RPC"
          : `fixture mode — recorded at ledger ${fixture.ledger}, no RPC`,
      ),
      ...deployment,
    );
    try {
      await verifySettledRoundProof(fixtureReader(fixture), manifest.settledRoundId, expectedRound);
      checks.push(
        check(
          "settled-round",
          "Settled round proof",
          "pass",
          `recorded round ${manifest.settledRoundId.toString()} settled with expected amounts`,
        ),
      );
    } catch (err) {
      checks.push(
        check(
          "settled-round",
          "Settled round proof",
          "block",
          normalizeError(err).message,
        ),
      );
    }
    if (input.withBalances && fixture.contractBalance !== undefined) {
      const balance = BigInt(fixture.contractBalance);
      checks.push(
        check(
          "contract-balance",
          "Contract escrow balance",
          balance === 0n ? "pass" : "block",
          balance === 0n
            ? "recorded contract escrow balance is 0"
            : `expected 0 stroops, recorded ${balance.toString()}`,
        ),
      );
    }
    return {
      mode: "fixture",
      checks,
      deployment: comparison,
      manifestSource: input.manifestSource,
      ...summarize(checks),
    };
  }

  // ── Live: read the deployment through the read-only client ───────────────
  const rpcServer = deps.rpc ?? new rpc.Server(input.rpcUrl);

  try {
    await rpcServer.getHealth();
    const latest = await rpcServer.getLatestLedger();
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "pass",
        `healthy (ledger ${latest.sequence})`,
      ),
    );
  } catch (err) {
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "block",
        normalizeError(err).message,
      ),
    );
  }

  const fetchWasmHash =
    deps.fetchWasmHash ??
    ((contractId: string) => fetchContractWasmHash(rpcServer, contractId));

  if (!deps.reader) {
    for (const field of DEPLOYMENT_FIELDS) {
      checks.push(
        check(
          DEPLOYMENT_CHECK_IDS[field],
          DEPLOYMENT_FIELD_LABELS[field],
          "block",
          "read-only client dependency missing — the deployment cannot be compared with the committed manifest",
        ),
      );
    }
    checks.push(
      check(
        "settled-round",
        "Settled round proof",
        "block",
        "reader dependency missing",
      ),
    );
    return {
      mode: "live",
      checks,
      manifestSource: input.manifestSource,
      ...summarize(checks),
    };
  }

  const liveDeployment = await readLiveDeployment(
    deps.reader,
    rpcServer,
    input.contractId,
    fetchWasmHash,
  );
  const { checks: deployment, comparison } = deploymentChecks(
    manifest,
    liveDeployment,
  );
  checks.push(...deployment);

  try {
    await verifySettledRoundProof(deps.reader, manifest.settledRoundId, expectedRound);
    checks.push(
      check(
        "settled-round",
        "Settled round proof",
        "pass",
        `round ${manifest.settledRoundId.toString()} settled with expected amounts`,
      ),
    );
  } catch (err) {
    checks.push(
      check(
        "settled-round",
        "Settled round proof",
        "block",
        normalizeError(err).message,
      ),
    );
  }

  if (input.withBalances) {
    const tokenSacId = input.tokenSacId ?? manifest.tokenContract;
    if (tokenSacId !== manifest.tokenContract) {
      checks.push(
        check(
          "contract-balance",
          "Contract escrow balance",
          "block",
          `refusing to read the balance of ${tokenSacId}: the committed manifest pins ${manifest.tokenContract}`,
        ),
      );
    } else {
      const sacBalance =
        deps.sacBalance ??
        createSacBalanceReader(
          input.rpcUrl,
          input.networkPassphrase,
          tokenSacId,
          input.operatorAccount ??
            input.keeperAccount ??
            "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR",
        );

      try {
        const contractBalance = await sacBalance(input.contractId);
        if (contractBalance === 0n) {
          checks.push(
            check(
              "contract-balance",
              "Contract escrow balance",
              "pass",
              "escrow token balance is 0",
            ),
          );
        } else {
          checks.push(
            check(
              "contract-balance",
              "Contract escrow balance",
              "block",
              `expected 0 stroops, got ${contractBalance.toString()}`,
            ),
          );
        }
      } catch (err) {
        checks.push(
          check(
            "contract-balance",
            "Contract escrow balance",
            "block",
            normalizeError(err).message,
          ),
        );
      }
    }

    const accountChecks: Array<{
      id: string;
      label: string;
      account?: string;
      min: bigint;
    }> = [
      {
        id: "operator-balance",
        label: "Operator XLM balance",
        account: input.operatorAccount,
        min: MAINNET_DEPLOY_MIN_XLM_STROOPS,
      },
      {
        id: "keeper-balance",
        label: "Keeper XLM balance",
        account: input.keeperAccount,
        min: MAINNET_MIN_FEE_RESERVE_STROOPS,
      },
      {
        id: "bidder-balance",
        label: "Bidder XLM balance",
        account: input.bidderAccount,
        min: MAINNET_MIN_FEE_RESERVE_STROOPS,
      },
    ];

    for (const { id, label, account, min } of accountChecks) {
      if (!account) {
        checks.push(
          check(id, label, "warn", "skipped — account not provided"),
        );
        continue;
      }
      try {
        const entry = await rpcServer.getAccountEntry(account);
        const balance = BigInt(entry.balance().toString());
        if (balance >= min) {
          checks.push(
            check(
              id,
              label,
              "pass",
              `${balance.toString()} stroops (min ${min.toString()})`,
            ),
          );
        } else {
          checks.push(
            check(
              id,
              label,
              "warn",
              `${balance.toString()} stroops below recommended ${min.toString()}`,
            ),
          );
        }
      } catch (err) {
        checks.push(
          check(
            id,
            label,
            "block",
            normalizeError(err).message,
          ),
        );
      }
    }
  }

  return {
    mode: "live",
    checks,
    deployment: comparison,
    manifestSource: input.manifestSource,
    ...summarize(checks),
  };
}

export function defaultMainnetReadinessInput(
  overrides: Partial<Omit<MainnetReadinessInput, "manifest">> = {},
  manifest: MainnetManifest = MAINNET_MANIFEST,
): MainnetReadinessInput {
  return {
    manifest,
    rpcUrl: manifest.rpcUrl,
    networkPassphrase: manifest.networkPassphrase,
    contractId: manifest.contractId,
    live: true,
    withBalances: false,
    ...overrides,
  };
}
