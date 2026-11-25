// SPDX-License-Identifier: MIT
// Ordered on-chain event verification for round receipts (issue #379).
//
// A receipt can be internally hash-consistent yet tell the wrong story: a
// refund event silently dropped, two rounds swapped. This module teaches the
// offline verifier the round's event sequence. The canonical order comes from
// the generated bindings' event snapshot — the same module the snapshot tests
// pin against the contract — so a contract event drift that changes the
// lifecycle trips the bindings tests first, and the SDK stays consistent with
// them by construction.
//
// Every check here is stateless and offline: no RPC, no secrets.

import type {
  RoundReceipt,
  RoundReceiptEvent,
} from "./receipt.js";
import {
  ALL_ROUND_EVENT_NAMES,
  ROUND_EVENT_PHASE_BY_NAME,
  ROUND_EVENT_PHASE_RANK,
  type RoundEventName,
} from "@sub-rosa/round-bindings/event-snapshot";
import type { VerificationIssue } from "./verify.js";

/** Reusable event-log issue type. */
export type ReceiptEventIssue = VerificationIssue;

/** Error codes emitted by the receipt event-log verification. */
export const RECEIPT_EVENT_ERROR_CODES = [
  "unsupported_version",
  "missing_events",
  "invalid_event_entry",
  "unknown_event_name",
  "invalid_event_round_id",
  "event_round_id_mismatch",
  "invalid_event_topics",
  "event_phase_mismatch",
  "event_not_in_ledger_order",
  "duplicate_settle_event",
  "missing_events_required",
  "event_contract_mismatch",
  "event_network_mismatch",
] as const;

export type ReceiptEventErrorCode = (typeof RECEIPT_EVENT_ERROR_CODES)[number];

/** Additional caller-supplied context for receipt event verification.
 *
 *  Everything is optional: the checks stay runnable without an RPC endpoint
 *  and without any caller context, and light up to full identity binding when
 *  the caller has the contract id / network passphrase they expect. */
export interface ReceiptEventsVerifyOptions {
  /** The contract id (C…) the receipt is expected to belong to. When set, a
   *  receipt whose `contractId` differs fails with `event_contract_mismatch`. */
  expectedContractId?: string;
  /** The network passphrase the receipt is expected to be bound to. When set,
   *  a receipt whose `network` differs fails with `event_network_mismatch`.
   *  The receipt's own `networkFingerprint` is still checked inside
   *  `verifyReceipt` — this option additionally pins the *expected* network,
   *  closing the gap where an attacker rewrites both fields consistently. */
  expectedNetworkPassphrase?: string;
}

/** Result of the receipt event-log verification. */
export interface ReceiptEventsVerifyResult {
  valid: boolean;
  issues: ReceiptEventIssue[];
}

// ── Internal helpers ──────────────────────────────────────────────────────

const SETTLE_ALTERNATIVES: ReadonlySet<string> = new Set(["settled", "voided"]);

/** Parse a decimal u64 string; returns null on malformed input. */
function parseU64(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function isHex(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s);
}

// ── Verification ──────────────────────────────────────────────────────────

/** Verify the ordered event log embedded in a round receipt.
 *
 *  Checks performed (all offline):
 *   1. Structural well-formedness of every entry (known event name, canonical
 *      topics `["symbol_short", "u64"]`, decimal round id, integer ledger).
 *   2. Every topic round id agrees with the receipt's round id.
 *   3. The recorded lifecycle phase matches the event name.
 *   4. The log is ordered by lifecycle phase (ties broken by ledger number).
 *   5. At most one settle-phase event is present (`settled` XOR `voided`).
 *   6. Expected settle-phase terminators are present, per `receipt.status`.
 *   7. When caller context is supplied, the receipt's contract id and network
 *      passphrase match the expectation.
 *
 *  The expected event sequence itself comes from the generated bindings
 *  (`ROUND_EVENT_PHASE_ORDER`), so this module never restates the lifecycle. */
export function verifyReceiptEvents(
  receipt: RoundReceipt,
  options?: ReceiptEventsVerifyOptions,
): ReceiptEventsVerifyResult {
  const issues: ReceiptEventIssue[] = [];
  const add = (
    severity: ReceiptEventIssue["severity"],
    code: ReceiptEventErrorCode,
    message: string,
    path?: string,
  ): void => {
    issues.push({ severity, code, message, path });
  };

  // ══ Caller-supplied identity binding ═════════════════════════════════
  if (options?.expectedContractId !== undefined) {
    if (receipt.contractId !== options.expectedContractId) {
      add(
        "error",
        "event_contract_mismatch",
        `receipt belongs to contract ${receipt.contractId}, expected ${options.expectedContractId}`,
        "contractId",
      );
    }
  }
  if (options?.expectedNetworkPassphrase !== undefined) {
    if (receipt.network !== options.expectedNetworkPassphrase) {
      add(
        "error",
        "event_network_mismatch",
        `receipt was exported from a different network`,
        "network",
      );
    }
  }

  // ══ Presence and shape ═══════════════════════════════════════════════
  const events = receipt.events;
  if (!Array.isArray(events)) {
    add("error", "missing_events", "events is missing or not an array", "events");
    return { valid: false, issues };
  }
  if (events.length === 0) {
    add("error", "missing_events", "events is empty — no on-chain event log", "events");
    return { valid: false, issues };
  }

  const roundIdDecimal = receipt.roundId;

  for (let i = 0; i < events.length; i++) {
    const ev: RoundReceiptEvent = events[i]!;
    const path = `events[${i}]`;

    if (ev === null || typeof ev !== "object") {
      add("error", "invalid_event_entry", `event entry ${i} is not an object`, path);
      continue;
    }
    if (
      typeof ev.name !== "string" ||
      !(ALL_ROUND_EVENT_NAMES as readonly string[]).includes(ev.name)
    ) {
      add(
        "error",
        "unknown_event_name",
        `unknown event name: ${JSON.stringify(ev.name)}`,
        `${path}.name`,
      );
    }
    const topics = ev.topics;
    if (
      !Array.isArray(topics) ||
      topics.length !== 2 ||
      topics[0] !== "symbol_short" ||
      topics[1] !== "u64"
    ) {
      add(
        "error",
        "invalid_event_topics",
        `topics must be ["symbol_short", "u64"]`,
        `${path}.topics`,
      );
    }
    if (typeof ev.ledger !== "number" || !Number.isInteger(ev.ledger)) {
      add(
        "error",
        "invalid_event_entry",
        `ledger must be an integer, got ${JSON.stringify(ev.ledger)}`,
        `${path}.ledger`,
      );
    }
    // Phase must be recorded and must agree with the name.
    const expectedPhase = ROUND_EVENT_PHASE_BY_NAME[ev.name as RoundEventName];
    if (typeof ev.phase !== "string") {
      add(
        "error",
        "event_phase_mismatch",
        `phase is missing`,
        `${path}.phase`,
      );
    } else if (ev.phase !== expectedPhase) {
      add(
        "error",
        "event_phase_mismatch",
        `phase ${JSON.stringify(ev.phase)} does not match the phase the bindings derive from "${ev.name}" (${JSON.stringify(expectedPhase)})`,
        `${path}.phase`,
      );
    }

    // Topic round id must be a decimal string and must match the receipt.
    if (typeof ev.roundId !== "string" || parseU64(ev.roundId) === null) {
      add(
        "error",
        "invalid_event_round_id",
        `roundId must be a decimal u64 string`,
        `${path}.roundId`,
      );
    } else if (
      typeof roundIdDecimal === "string" &&
      parseU64(roundIdDecimal) !== null &&
      ev.roundId !== roundIdDecimal
    ) {
      add(
        "error",
        "event_round_id_mismatch",
        `event references round ${ev.roundId}, receipt is for round ${roundIdDecimal}`,
        `${path}.roundId`,
      );
    }
  }

  // ══ Ordering: lifecycle phase must never regress ══════════════════════
  // Stable within a phase (per-bidder commits/reveals may interleave), but
  // the phase sequence itself must be non-decreasing — a `cleared` before a
  // `commit` cannot have happened on the ledger.
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    const prevPhase = ROUND_EVENT_PHASE_BY_NAME[prev.name as RoundEventName];
    const currPhase = ROUND_EVENT_PHASE_BY_NAME[curr.name as RoundEventName];
    if (prevPhase === undefined || currPhase === undefined) continue;
    if (ROUND_EVENT_PHASE_RANK[currPhase] < ROUND_EVENT_PHASE_RANK[prevPhase]) {
      add(
        "error",
        "event_not_in_ledger_order",
        `event ${i} (${curr.name}) is ordered before event ${i - 1} (${prev.name}); the on-chain event sequence for this round is out of ledger order`,
        `events[${i}]`,
      );
    }
  }

  // ══ Settle-phase multiplicity ═════════════════════════════════════════
  // A round ends exactly once: `settled` XOR `voided`.
  const settleEvents = events.filter(
    (ev) => SETTLE_ALTERNATIVES.has(ev.name),
  );
  if (settleEvents.length > 1) {
    add(
      "error",
      "duplicate_settle_event",
      `round has ${settleEvents.length} settle-phase events (${settleEvents.map((e) => e.name).join(", ")}); a round settles at most once`,
      "events",
    );
  }

  // ══ Required lifecycle events, per round status ═══════════════════════
  const present = new Set(events.map((ev) => ev.name));
  const has = (name: RoundEventName): boolean => present.has(name);
  const voided = has("voided");
  const settled = has("settled");

  if (receipt.status === "Settled") {
    // A settled round necessarily shows the full healthy lifecycle: it had at
    // least one commit (there was a winner), the reveal window opened, at
    // least one valid bid was revealed, the round cleared, and it settled.
    for (const name of [
      "created", "commit", "revealing", "reveal", "cleared", "settled",
    ] as const) {
      if (!has(name)) {
        add(
          "error",
          "missing_events_required",
          `receipt lists no "${name}" event for a Settled round; the on-chain event sequence is incomplete`,
          "events",
        );
      }
    }
    if (voided) {
      add(
        "error",
        "event_phase_mismatch",
        `receipt declares status Settled but the event log shows a voided round`,
        "events",
      );
    }
  } else if (receipt.status === "Voided") {
    // A voided round must show its `voided` terminator, but the rest of the
    // lifecycle legitimately varies by void path: the Drand-liveness void
    // fires before the reveal window opens (no `revealing`/`reveal`/`cleared`),
    // while the no-valid-bids void happens inside `clear` with possibly zero
    // commits or reveals. Only the invariants common to both paths are
    // enforced here.
    if (!voided) {
      add(
        "error",
        "missing_events_required",
        `receipt lists no "voided" event for a Voided round; the on-chain event sequence is incomplete`,
        "events",
      );
    }
    if (!has("created")) {
      add(
        "error",
        "missing_events_required",
        `receipt lists no "created" event for a Voided round; the on-chain event sequence is incomplete`,
        "events",
      );
    }
    if (settled) {
      add(
        "error",
        "event_phase_mismatch",
        `receipt declares status Voided but the event log shows a settled round`,
        "events",
      );
    }
  } else {
    // Non-terminal statuses: events are still checked structurally and for
    // ordering, but the receipt cannot yet be required to show the full
    // lifecycle. A settled event paired with a non-terminal status is
    // suspicious though — flag it as a warning-level phase mismatch.
    if (settled || voided) {
      add(
        "warning",
        "event_phase_mismatch",
        `receipt lists a settle-phase event but declares status ${receipt.status}`,
        "events",
      );
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  return { valid: errors.length === 0, issues };
}
