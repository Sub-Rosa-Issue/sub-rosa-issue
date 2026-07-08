// Round contract event snapshot.
//
// Generated Soroban bindings (`@sub-rosa/round-bindings`) expose the contract's
// Spec (method shapes), but contract **events** are emitted via
// `env.events().publish(...)` and never appear in the method Spec. SDK
// consumers (keeper, web, receipt-cli) and any future indexer rely on a stable
// tuple of (event_name, round_id) on the topic and a per-event data shape.
//
// This module is the canonical TS-encoded form of the event surface, used by
// snapshot tests to catch contract event drift. The updating procedure lives
// in SNAPSHOT_TESTS.md.
//
// Reference: every `symbol_short!(...)` call site in `contracts/round/src/lib.rs`.

// ── Event surface ─────────────────────────────────────────────────────────

/** Names that the Round contract is allowed to emit on the first topic slot. */
export type RoundEventName =
  | "created"
  | "commit"
  | "revealing"
  | "reveal"
  | "cleared"
  | "settled"
  | "voided";

/** Sorted alphabetically — assertable against itself for invariant drift. */
export const ALL_ROUND_EVENT_NAMES: readonly RoundEventName[] = [
  "cleared",
  "commit",
  "created",
  "reveal",
  "revealing",
  "settled",
  "voided",
] as const;

/** Distinct event slot the keeper / indexer / receipt exporter subscribe to.
 *  Used when filtering RPC `getEvents` streams by topic. */
export interface RoundEventDescriptor {
  /** Soroban `symbol_short!` value, exactly as embedded in the topic[0]. */
  name: RoundEventName;
  /** Source-of-truth file path inside contracts/round. */
  emittedBy: string;
  /** Contract method whose `env.events().publish(...)` produces this event.
   *  The `voided` event is emitted by both `clear` and `void` (different
   *  discriminator values) — recorded as `clear-or-void` to make that
   *  ambiguity explicit instead of leaking it through grep. */
  contractMethod:
    | "create_round"
    | "commit"
    | "open_reveal"
    | "reveal"
    | "clear"
    | "settle"
    | "void"
    | "clear-or-void";
  /** Ordered list of data tuple fields, in the exact order the contract emits
   *  them (post-ScVal decode). Used as the immutable schema for downstream
   *  consumers — additional fields here would be a backward-compatible
   *  addition, reordering or removal is a breaking change. */
  dataShape: readonly string[];
  /** Per-field human-readable type, for documentation and drift messages. */
  dataTypes: Readonly<Record<string, string>>;
  /** Distinct data tuple arity. Strict equal to dataShape.length. */
  arity: number;
  /** Whether the data tuple ends with a single optional/nullable trailing
   *  field (e.g. `voided` has a single discriminator u32). Keys are decimal
   *  strings so this is JSON-stable — `Record<number, …>` would lose
   *  discrimination between 0 and "0" in fixtures. */
  singleDiscriminator?: { key: string; values: Record<string, string> };
}

/**
 * Canonical event snapshot. **Do not edit casually** — every entry locks the
 * event name, method that emits it, and the data tuple shape TypeScript code
 * reads. When contract events change intentionally, follow the procedure in
 * `packages/round-bindings/SNAPSHOT_TESTS.md` and refresh this constant in
 * the same commit as the contract change.
 */
export const ROUND_EVENT_SNAPSHOT: readonly RoundEventDescriptor[] =
    [
      {
        name: "created",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::create_round",
        contractMethod: "create_round",
        arity: 3,
        dataShape: ["operator", "reveal_round", "commit_deadline"],
        dataTypes: {
          operator: "Address",
          reveal_round: "u64",
          commit_deadline: "u64",
        },
      },
      {
        name: "commit",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::commit",
        contractMethod: "commit",
        arity: 2,
        dataShape: ["bidder", "escrow"],
        dataTypes: {
          bidder: "Address",
          escrow: "i128",
        },
      },
      {
        name: "revealing",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::open_reveal",
        contractMethod: "open_reveal",
        arity: 1,
        dataShape: ["reveal_round"],
        dataTypes: {
          reveal_round: "u64",
        },
      },
      {
        name: "reveal",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::reveal",
        contractMethod: "reveal",
        arity: 3,
        dataShape: ["bidder", "value", "valid"],
        dataTypes: {
          bidder: "Address",
          value: "i128",
          valid: "bool",
        },
      },
      {
        name: "cleared",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::clear",
        contractMethod: "clear",
        arity: 2,
        dataShape: ["winner", "winning_bid"],
        dataTypes: {
          winner: "Address",
          winning_bid: "i128",
        },
      },
      {
        name: "settled",
        emittedBy: "contracts/round/src/lib.rs::SubRosaRound::settle",
        contractMethod: "settle",
        arity: 2,
        dataShape: ["winner", "winning_bid"],
        dataTypes: {
          winner: "Address",
          winning_bid: "i128",
        },
      },
      {
        name: "voided",
        emittedBy:
          "contracts/round/src/lib.rs::SubRosaRound::clear OR SubRosaRound::void",
        contractMethod: "clear-or-void",
        arity: 1,
        dataShape: ["discriminator"],
        dataTypes: {
          // 0 is emitted by the no-valid-bids void path inside `clear`,
          // 1 is emitted by the public `void()` Drand-liveness path.
          discriminator: "u32",
        },
        singleDiscriminator: {
          key: "discriminator",
          values: { "0": "no_valid_bids", "1": "drand_liveness_grace" },
        },
      },
    ] as const;

/** Map: event name → descriptor. Populated from the snapshot. */
export const ROUND_EVENT_BY_NAME: Readonly<
  Record<RoundEventName, RoundEventDescriptor>
> = (() => {
  const out = {} as Record<RoundEventName, RoundEventDescriptor>;
  for (const desc of ROUND_EVENT_SNAPSHOT) {
    if (out[desc.name]) {
      throw new Error(
        `ROUND_EVENT_SNAPSHOT has duplicate entry for "${desc.name}"; ` +
          `this is a snapshot authoring bug, not a contract bug.`,
      );
    }
    out[desc.name] = desc;
  }
  // Force exhaustiveness: every event in the snapshot must be looked up by name.
  for (const name of ALL_ROUND_EVENT_NAMES) {
    if (!out[name]) {
      throw new Error(
        `ROUND_EVENT_SNAPSHOT is missing the "${name}" entry; update the snapshot`,
      );
    }
  }
  return out;
})();

// ── Topic + data decoders (deterministic, no RPC) ─────────────────────────
//
// In the real flow these helpers would run on values produced by
// `scValToNative(...)` against XDR fetched from Soroban RPC. For the snapshot
// tests we drive the same code path with in-memory fixtures so the bindings
// package can be exercised without a live RPC.

/** A decoded Soroban Symbol ScVal — opaque 9-byte form pre-decoded to ASCII. */
export type ScValSymbol = { type: "symbol"; value: string };

/** A decoded Soroban contract event topic element. We handle only the value
 *  kinds the Round contract emits. Other shapes throw to surface drift. */
export type TopicElement =
  | ScValSymbol
  | { type: "u64"; value: bigint };

/** Post-XDR-decoding data tuple element. Same shape worked out by
 *  `scValToNative` against the contract's published event tuples. */
export type DataField =
  | { type: "address"; value: string }
  | { type: "u64"; value: bigint }
  | { type: "i128"; value: bigint }
  | { type: "u32"; value: number }
  | { type: "bool"; value: boolean };

export interface DecodedRoundEvent {
  name: RoundEventName;
  roundId: bigint;
  /** Data tuple post-decoded into a keyed record in the documented order. */
  data: Record<string, DataField["value"]>;
  /** Resolved descriptor — kept on the decoded event for downstream filters. */
  descriptor: RoundEventDescriptor;
}

/** Pull the event name + round id from a Soroban event's topic slot.
 *
 *  Returns `name: null` for unknown topic[0] symbols. When topic[0] is not a
 *  `symbol` shape, we still surface `roundId` from topic[1] if it parses as a
 *  `u64` — losing the round id forces callers to re-fetch the event, which is
 *  strictly worse than surfacing a best-effort round id with `name: null`. */
export function decodeEventTopic(topics: ReadonlyArray<TopicElement>): {
  name: RoundEventName | null;
  roundId: bigint | null;
} {
  if (topics.length < 2) return { name: null, roundId: null };
  const roundIdEl = topics[1];
  const roundId = roundIdEl?.type === "u64" ? roundIdEl.value : null;

  const head = topics[0];
  if (head.type !== "symbol") return { name: null, roundId };
  const name = head.value as RoundEventName;
  const isKnown = ALL_ROUND_EVENT_NAMES.includes(name);
  return { name: isKnown ? name : null, roundId };
}

/** Convert a decoded data tuple into a keyed record matching the snapshot. */
export function normalizeEventData(
  descriptor: RoundEventDescriptor,
  dataTuple: ReadonlyArray<DataField>,
): Record<string, DataField["value"]> {
  if (dataTuple.length !== descriptor.arity) {
    throw new Error(
      `data tuple arity mismatch for "${descriptor.name}": ` +
        `expected ${descriptor.arity}, got ${dataTuple.length}`,
    );
  }
  const out: Record<string, DataField["value"]> = {};
  for (let i = 0; i < descriptor.arity; i++) {
    const key = descriptor.dataShape[i];
    out[key] = dataTuple[i]!.value;
  }
  return out;
}

/** One-shot helper: parse a Soroban event record into a `DecodedRoundEvent`,
 *  or `null` if the topic doesn't reference a known Round event. */
export function decodeRoundEvent(
  topics: ReadonlyArray<TopicElement>,
  dataTuple: ReadonlyArray<DataField> = [],
): DecodedRoundEvent | null {
  const { name, roundId } = decodeEventTopic(topics);
  if (!name || roundId === null) return null;
  const descriptor = ROUND_EVENT_BY_NAME[name];
  return {
    name,
    roundId,
    data: normalizeEventData(descriptor, dataTuple),
    descriptor,
  };
}

/** Sort a topic array by ascending event name. Useful for stable diff output
 *  when the snapshot is regenerated. */
export function compareDescriptors(a: RoundEventDescriptor, b: RoundEventDescriptor): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
