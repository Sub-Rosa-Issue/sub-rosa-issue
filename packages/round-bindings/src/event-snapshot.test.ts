// Snapshot tests for the Round contract event surface.
//
// These tests are the single source of truth — for the TypeScript code in
// @sub-rosa/sdk, services/keeper, services/agent, apps/web, and any future
// indexer — that the names of the seven Round contract events and the field
// keys of their data tuples have not drifted.
//
// What we test:
//   1. The TS snapshot is internally consistent (Group 1).
//   2. The TS snapshot matches the JSON golden fixture (Group 2).
//   3. Deterministic in-memory event payloads round-trip through the decoders
//      and yield the exact keys/types the snapshot documents (Group 3).
//   4. The validation actually catches drift: feeding tampered fixtures
//      (rename / reorder / drop / version / type / discriminator-swap) into
//      the Group-2 helper makes it throw (Group 4).
//
// Reference: contracts/round/src/lib.rs and packages/round-bindings/src/event-snapshot.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_ROUND_EVENT_NAMES,
  ROUND_EVENT_BY_NAME,
  ROUND_EVENT_SNAPSHOT,
  decodeRoundEvent,
  decodeEventTopic,
  normalizeEventData,
  type RoundEventName,
  type TopicElement,
  type DataField,
} from "./event-snapshot.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(DIR, "..", "fixtures");

function loadJsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), "utf-8"));
}

// ── Helpers for building in-memory event fixtures (post-ScVal decode) ────────
//
// `scValToNative(...)` produces values like these on the consumer side. We use
// the same shapes so the decoders are exercised end-to-end with no RPC.

// These are not StrKey-valid; the decoder treats them as opaque G-prefixed
// strings, so the test only needs them to be deterministic, not crypto-valid.
const ADDRESS_FIXTURES = {
  operator: "GBCDABQZOSZG4Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X",
  bidder1: "GA4GN2X7YQKQJF5Y5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3X5X3",
  bidder2: "GB5HN3Y8ZRLRK6Z6Y4X4Y4X4Y4X4Y4X4Y4X4X4Y4Y4Y4Y4X4Y4",
};

function symbolTopic(name: RoundEventName): TopicElement {
  return { type: "symbol", value: name };
}

function roundIdTopic(rid: number | bigint): TopicElement {
  return { type: "u64", value: BigInt(rid) };
}

function address(value: string): DataField {
  return { type: "address", value };
}

function u64(value: number | bigint): DataField {
  return { type: "u64", value: BigInt(value) };
}

function i128(value: number | bigint): DataField {
  return { type: "i128", value: BigInt(value) };
}

function u32(value: number): DataField {
  return { type: "u32", value };
}

function bool(value: boolean): DataField {
  return { type: "bool", value };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared validator: ensure (fixture) matches (TS snapshot). Group 2 uses it
// against the on-disk golden; Group 4 uses it against tampered copies to
// demonstrate that drift actually breaks the suite.
// ────────────────────────────────────────────────────────────────────────────

interface FixtureShape {
  version: number;
  contract: string;
  topicShape: string[];
  events: Array<{
    name: string;
    contractMethod: string;
    emittedBy: string;
    dataShape: string[];
    arity: number;
    dataTypes: Record<string, string>;
    singleDiscriminator?: { key: string; values: Record<string, string> };
  }>;
}

function assertFixtureMatchesSnapshot(fixture: FixtureShape): void {
  if (fixture.version !== 1) {
    throw new Error(`fixture schema version mismatch: expected 1, got ${fixture.version}`);
  }
  if (fixture.contract !== "SubRosaRound") {
    throw new Error(`fixture.contract mismatch: expected SubRosaRound, got ${fixture.contract}`);
  }
  if (
    fixture.topicShape.length !== 2 ||
    fixture.topicShape[0] !== "symbol_short" ||
    fixture.topicShape[1] !== "u64"
  ) {
    throw new Error(
      `fixture.topicShape mismatch: got [${fixture.topicShape.join(", ")}], expected [symbol_short, u64]`,
    );
  }

  if (fixture.events.length !== ROUND_EVENT_SNAPSHOT.length) {
    throw new Error(
      `fixture event count mismatch: expected ${ROUND_EVENT_SNAPSHOT.length}, got ${fixture.events.length}`,
    );
  }

  for (let i = 0; i < fixture.events.length; i++) {
    const f = fixture.events[i]!;
    const t = ROUND_EVENT_SNAPSHOT[i]!;
    if (f.name !== t.name) {
      throw new Error(
        `event[${i}].name mismatch: fixture=${f.name}, snapshot=${t.name}`,
      );
    }
    if (f.contractMethod !== t.contractMethod) {
      throw new Error(
        `event[${i}].contractMethod mismatch for "${f.name}": ` +
          `fixture=${f.contractMethod}, snapshot=${t.contractMethod}`,
      );
    }
    if (
      f.dataShape.length !== t.dataShape.length ||
      f.dataShape.some((k, idx) => k !== t.dataShape[idx])
    ) {
      throw new Error(
        `event[${i}].dataShape mismatch for "${f.name}": ` +
          `fixture=[${f.dataShape.join(", ")}], snapshot=[${t.dataShape.join(", ")}]`,
      );
    }
    if (f.arity !== t.arity) {
      throw new Error(
        `event[${i}].arity mismatch for "${f.name}": ` +
          `fixture=${f.arity}, snapshot=${t.arity}`,
      );
    }
    // dataTypes is structurally unordered in JSON, so compare keys sorted +
    // values. Comparing by signature means both fixture and snapshot must
    // specify the same per-field type — a swap that renames a key (e.g.
    // "escrow" -> "amount") changes the signature and trips here.
    const fTypeSig = Object.keys(f.dataTypes)
      .sort()
      .map((k) => `${k}=${f.dataTypes[k]}`)
      .join(",");
    const tTypeSig = Object.keys(t.dataTypes)
      .sort()
      .map((k) => `${k}=${t.dataTypes[k as keyof typeof t.dataTypes]}`)
      .join(",");
    if (fTypeSig !== tTypeSig) {
      throw new Error(
        `event[${i}].dataTypes signature mismatch for "${f.name}": ` +
          `fixture={${fTypeSig}}, snapshot={${tTypeSig}}`,
      );
    }

    // Drift in the discriminator semantic meaning (no_valid_bids vs
    // drand_liveness_grace) is silently fatal — a downstream indexer
    // routing off the discriminator value would misclassify rounds.
    const snapDisc = t.singleDiscriminator;
    const fixDisc = f.singleDiscriminator;
    if (snapDisc && !fixDisc) {
      throw new Error(
        `event[${i}].singleDiscriminator missing in fixture for "${f.name}"`,
      );
    }
    if (!snapDisc && fixDisc) {
      throw new Error(
        `event[${i}].singleDiscriminator present in fixture but absent in snapshot for "${f.name}"`,
      );
    }
    if (snapDisc && fixDisc) {
      if (snapDisc.key !== fixDisc.key) {
        throw new Error(
          `event[${i}].singleDiscriminator.key mismatch for "${f.name}": ` +
            `fixture="${fixDisc.key}", snapshot="${snapDisc.key}"`,
        );
      }
      const sdSnap = Object.keys(snapDisc.values)
        .sort()
        .map((k) => `${k}=${snapDisc.values[k]}`)
        .join(",");
      const sdFix = Object.keys(fixDisc.values)
        .sort()
        .map((k) => `${k}=${fixDisc.values[k]}`)
        .join(",");
      if (sdSnap !== sdFix) {
        throw new Error(
          `event[${i}].singleDiscriminator.values mismatch for "${f.name}": ` +
            `fixture={${sdFix}}, snapshot={${sdSnap}}`,
        );
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Group 1: snapshot structural invariants
// ────────────────────────────────────────────────────────────────────────────

test("snapshot has exactly seven Round events", () => {
  assert.equal(
    ROUND_EVENT_SNAPSHOT.length,
    7,
    "the Round contract emits exactly seven events: " +
      "created, commit, revealing, reveal, cleared, settled, voided",
  );
  assert.equal(ALL_ROUND_EVENT_NAMES.length, 7);
});

test("snapshot covers the safety-critical lifecycle", () => {
  // Round created, commit submitted, reveal/settle, refund/cleanup. Exactly
  // the four buckets called out in the issue acceptance criteria.
  const required: RoundEventName[] = [
    "created",
    "commit",
    "reveal",
    "settled",
    "voided",
  ];
  const present = new Set(ROUND_EVENT_SNAPSHOT.map((d) => d.name));
  for (const name of required) {
    assert.ok(
      present.has(name),
      `snapshot is missing required lifecycle event "${name}"`,
    );
  }
});

test("every snapshot entry is reachable through the lookup table", () => {
  for (const desc of ROUND_EVENT_SNAPSHOT) {
    assert.equal(
      ROUND_EVENT_BY_NAME[desc.name]?.name,
      desc.name,
      `ROUND_EVENT_BY_NAME lookup table is out of sync at "${desc.name}"`,
    );
  }
});

test("snapshot data shape arity matches declared arity", () => {
  for (const desc of ROUND_EVENT_SNAPSHOT) {
    assert.equal(
      desc.dataShape.length,
      desc.arity,
      `arity mismatch for "${desc.name}": dataShape has ${desc.dataShape.length}, arity is ${desc.arity}`,
    );
    assert.equal(
      Object.keys(desc.dataTypes).length,
      desc.arity,
      `dataTypes key count mismatch for "${desc.name}"`,
    );
    for (const key of desc.dataShape) {
      assert.ok(
        key in desc.dataTypes,
        `dataTypes is missing key "${key}" for event "${desc.name}"`,
      );
    }
  }
});

test("snapshot contract method names are valid reference identifiers", () => {
  for (const desc of ROUND_EVENT_SNAPSHOT) {
    assert.ok(
      desc.contractMethod.length > 0,
      `contractMethod for "${desc.name}" must not be empty`,
    );
    assert.ok(
      desc.emittedBy.includes(".rs::"),
      `emittedBy must reference a Rust source location for "${desc.name}"`,
    );
  }
  // The seven contract-emit methods that appear in lib.rs are all distinct.
  // `voided` is emitted by both `clear` and `void` so its descriptor records
  // `clear-or-void`; we still enforce uniqueness across the seven entries.
  const methods = new Set(ROUND_EVENT_SNAPSHOT.map((d) => d.contractMethod));
  assert.equal(
    methods.size,
    ROUND_EVENT_SNAPSHOT.length,
    "every contractMethod in the snapshot must be unique",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Group 2: snapshot matches the golden JSON fixture
// ────────────────────────────────────────────────────────────────────────────

test("snapshot matches packages/round-bindings/fixtures/event-snapshot.json", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  assertFixtureMatchesSnapshot(fixture);
});

// ────────────────────────────────────────────────────────────────────────────
// Group 3: decode helpers — deterministic, no RPC, no Soroban host
// ────────────────────────────────────────────────────────────────────────────

test("decodeEventTopic ignores unknown topic[0] events", () => {
  const unknown = decodeEventTopic([
    { type: "symbol", value: "NotARoundEvent" as unknown as RoundEventName },
    roundIdTopic(7),
  ]);
  assert.equal(unknown.name, null);
  assert.equal(unknown.roundId, 7n);
});

test("decodeEventTopic rejects malformed topics but preserves the round id when known", () => {
  // Empty topic slot — no round id to surface.
  assert.deepEqual(decodeEventTopic([]), { name: null, roundId: null });
  // topic[0] is not a symbol — but topic[1] still carries a u64, so the
  // round id surfaces for callers that want to log the bad event.
  assert.deepEqual(
    decodeEventTopic([roundIdTopic(7), roundIdTopic(7)]),
    { name: null, roundId: 7n },
  );
  // Only one topic — even if it is a valid symbol, no round id is possible.
  assert.deepEqual(
    decodeEventTopic([symbolTopic("created")]),
    { name: null, roundId: null },
  );
});

test("normalizeEventData enforces tuple arity", () => {
  const desc = ROUND_EVENT_BY_NAME.commit;
  assert.throws(
    () => normalizeEventData(desc, [address("GA…")]),
    /arity mismatch for "commit"/,
    "an undersized data tuple must be rejected",
  );
  assert.throws(
    () =>
      normalizeEventData(desc, [
        address("GA…"),
        i128(1),
        u32(0),
      ]),
    /arity mismatch for "commit"/,
    "an oversize data tuple must be rejected",
  );
});

test("every event decodes a deterministic in-memory payload to its documented keys", () => {
  // Run a deterministic fixture per event and assert the *exact* key set the
  // snapshot documents. A contract drift that renames or reorders a field
  // will fail here even if the spec still matches the JSON fixture.
  type Case = {
    name: RoundEventName;
    topics: TopicElement[];
    data: DataField[];
    expect: Record<string, unknown>;
  };
  const rid = 42n;
  const cases: Case[] = [
    {
      name: "created",
      topics: [symbolTopic("created"), roundIdTopic(rid)],
      data: [address(ADDRESS_FIXTURES.operator), u64(2_000), u64(1_500)],
      expect: {
        operator: ADDRESS_FIXTURES.operator,
        reveal_round: 2_000n,
        commit_deadline: 1_500n,
      },
    },
    {
      name: "commit",
      topics: [symbolTopic("commit"), roundIdTopic(rid)],
      data: [address(ADDRESS_FIXTURES.bidder1), i128(500)],
      expect: { bidder: ADDRESS_FIXTURES.bidder1, escrow: 500n },
    },
    {
      name: "revealing",
      topics: [symbolTopic("revealing"), roundIdTopic(rid)],
      data: [u64(2_000)],
      expect: { reveal_round: 2_000n },
    },
    {
      name: "reveal",
      topics: [symbolTopic("reveal"), roundIdTopic(rid)],
      data: [address(ADDRESS_FIXTURES.bidder2), i128(750), bool(true)],
      expect: {
        bidder: ADDRESS_FIXTURES.bidder2,
        value: 750n,
        valid: true,
      },
    },
    {
      name: "cleared",
      topics: [symbolTopic("cleared"), roundIdTopic(rid)],
      data: [address(ADDRESS_FIXTURES.bidder2), i128(750)],
      expect: { winner: ADDRESS_FIXTURES.bidder2, winning_bid: 750n },
    },
    {
      name: "settled",
      topics: [symbolTopic("settled"), roundIdTopic(rid)],
      data: [address(ADDRESS_FIXTURES.bidder2), i128(750)],
      expect: { winner: ADDRESS_FIXTURES.bidder2, winning_bid: 750n },
    },
    {
      name: "voided",
      topics: [symbolTopic("voided"), roundIdTopic(rid)],
      data: [u32(0)],
      expect: { discriminator: 0 },
    },
  ];

  for (const c of cases) {
    const ev = decodeRoundEvent(c.topics, c.data);
    assert.ok(ev, `expected "${c.name}" to decode from a valid topic`);
    assert.equal(ev!.name, c.name);
    assert.equal(ev!.roundId, rid);
    assert.deepEqual(
      ev!.data,
      c.expect,
      `decoded data keys/types for "${c.name}" drifted from the snapshot`,
    );
    assert.deepEqual(
      Object.keys(ev!.data),
      [...ev!.descriptor.dataShape],
      `keys returned for "${c.name}" must be exactly dataShape order`,
    );
  }
});

test("voided event's discriminator is distinguishable for both code paths", () => {
  const noValid = decodeRoundEvent(
    [symbolTopic("voided"), roundIdTopic(1n)],
    [u32(0)],
  )!;
  assert.equal(noValid.data.discriminator, 0);
  assert.equal(
    noValid.descriptor.singleDiscriminator?.values["0"],
    "no_valid_bids",
  );

  const liveness = decodeRoundEvent(
    [symbolTopic("voided"), roundIdTopic(2n)],
    [u32(1)],
  )!;
  assert.equal(liveness.data.discriminator, 1);
  assert.equal(
    liveness.descriptor.singleDiscriminator?.values["1"],
    "drand_liveness_grace",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Group 4: drift detection — feeding tampered fixtures through the shared
// validator used in Group 2 must trip. These are the tests that prove the
// suite is non-tautological.
// ────────────────────────────────────────────────────────────────────────────

function cloneFixture(fixture: FixtureShape): FixtureShape {
  return JSON.parse(JSON.stringify(fixture)) as FixtureShape;
}

function renameEvent(
  fixture: FixtureShape,
  oldName: string,
  newName: string,
): FixtureShape {
  const next = cloneFixture(fixture);
  for (const e of next.events) {
    if (e.name === oldName) e.name = newName;
  }
  return next;
}

/** Realistic contract drift: the data tuple positions are swapped AND the
 *  `dataTypes` keys are renamed to match. This models a production refactor
 *  where someone reordered fields consistently across both axes. */
function swapCommitFields(fixture: FixtureShape): FixtureShape {
  const next = cloneFixture(fixture);
  for (const e of next.events) {
    if (e.name !== "commit") continue;
    e.dataShape = ["escrow", "bidder"];
    e.dataTypes = {
      escrow: e.dataTypes.bidder!,
      bidder: e.dataTypes.escrow!,
    };
  }
  return next;
}

function dropEvent(fixture: FixtureShape, name: string): FixtureShape {
  const next = cloneFixture(fixture);
  next.events = next.events.filter((e) => e.name !== name);
  return next;
}

function swapDiscriminatorMeanings(fixture: FixtureShape): FixtureShape {
  const next = cloneFixture(fixture);
  for (const e of next.events) {
    if (e.name !== "voided" || !e.singleDiscriminator) continue;
    e.singleDiscriminator = {
      ...e.singleDiscriminator,
      values: {
        "0": e.singleDiscriminator.values["1"]!,
        "1": e.singleDiscriminator.values["0"]!,
      },
    };
  }
  return next;
}

test("drift: renaming 'commit' to 'submit' is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = renameEvent(fixture, "commit", "submit");
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /event\[1\]\.name mismatch:.*commit/,
    "the validator must reject a renamed event by name",
  );
});

test("drift: swapping commit dataShape AND dataTypes is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = swapCommitFields(fixture);
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /event\[1\]\.dataShape mismatch for "commit"/,
    "the validator must reject reordered data fields, even when dataTypes is renamed to match",
  );
});

test("drift: dropping 'voided' is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = dropEvent(fixture, "voided");
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /fixture event count mismatch: expected 7, got 6/,
    "the validator must reject a dropped event by count",
  );
});

test("drift: changing the schema version is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = { ...fixture, version: 2 };
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /fixture schema version mismatch: expected 1, got 2/,
  );
});

test("drift: mutating a data field type (i128->string) is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = cloneFixture(fixture);
  for (const e of tampered.events) {
    if (e.name !== "commit") continue;
    e.dataTypes = { ...e.dataTypes, escrow: "string" };
  }
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /event\[1\]\.dataTypes signature mismatch for "commit"/,
  );
});

test("drift: swapping voided discriminator meanings is caught by the validator", () => {
  const fixture = loadJsonFixture("event-snapshot.json") as FixtureShape;
  const tampered = swapDiscriminatorMeanings(fixture);
  assert.throws(
    () => assertFixtureMatchesSnapshot(tampered),
    /event\[6\]\.singleDiscriminator\.values mismatch for "voided"/,
    "the validator must reject a swapped discriminator meaning",
  );
});
