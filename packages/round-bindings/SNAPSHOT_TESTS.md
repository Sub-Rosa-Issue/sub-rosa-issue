# Round contract event snapshot tests

The Round contract emits seven **on-chain events** via
`env.events().publish((symbol_short!("…"), round_id), …)`. Generated
TypeScript bindings (`@sub-rosa/round-bindings`) expose the contract
**method** spec (`Spec`), but events are not in the spec — so a silent
rename of `symbol_short!("commit")` to `symbol_short!("submit")` would not
be caught by standard bindings tests, but it would silently break the
keeper, agent, web app, and any future indexer.

This directory contains the single source of truth for the event surface
of the Round contract, plus tests that fail on drift.

## What's here

| File | Purpose |
| --- | --- |
| `src/event-snapshot.ts` | TS module exporting `RoundEventName`, `ALL_ROUND_EVENT_NAMES`, `ROUND_EVENT_SNAPSHOT`, `ROUND_EVENT_BY_NAME`, and `decodeRoundEvent` / `decodeEventTopic` / `normalizeEventData` helpers. |
| `src/event-snapshot.test.ts` | Node test suite that (1) asserts the snapshot is internally consistent, (2) asserts it matches the JSON golden fixture, and (3) round-trips a deterministic in-memory payload through the decoders for each event. |
| `fixtures/event-snapshot.json` | Golden JSON snapshot — same shape as `ROUND_EVENT_SNAPSHOT`, readable by any language or toolchain. |

## When contract events change intentionally

If you intentionally rename, add, reorder, or remove a Round event:

1. **Edit the contract first.** Update the `env.events().publish(…)`
   call site in `contracts/round/src/lib.rs`.

2. **Edit `fixtures/event-snapshot.json`.** Update the matching entry
   (and `version` if you are adding to / reordering the schema).

3. **Edit `src/event-snapshot.ts`.** Update `ROUND_EVENT_SNAPSHOT` (and
   `ALL_ROUND_EVENT_NAMES` if adding/removing an event). Keep
   `ROUND_EVENT_BY_NAME` keys in sync — the module asserts this at load
   time and will throw if they disagree.

4. **Update `src/event-snapshot.test.ts`.** If you are:
   - **Renaming an event** in the contract: rename the same symbol in
     every test case and in `ALL_ROUND_EVENT_NAMES`.
   - **Reordering data fields**: update the `expect` object for the
     affected event after reordering `dataShape[i]` in the JSON fixture
     and TS snapshot.
   - **Adding a new event**: add a new entry to the snapshot, the JSON
     fixture, and a fresh `Case` in `Group 3` of the test suite. Update
     `ALL_ROUND_EVENT_NAMES` and the `expected event count` test (it
     currently expects **7**).
   - **Removing an event**: delete the entry from the snapshot, the
     JSON fixture, the test `Group 3` case, and any helper that
     references it. Update the count.

5. **Run the snapshot tests.** From the repo root:

   ```bash
   pnpm --filter @sub-rosa/round-bindings test
   pnpm --filter @sub-rosa/round-bindings typecheck
   ```

   Both must pass before you push.

6. **Regenerate the bindings** if your contract changes touched types
   used by the existing method surface (`u64`, `i128`, `Address`). The
   event snapshot is independent of the generated method spec, so
   re-generation is not strictly required for purely event-only changes
   — but it is the safer default.

7. **Propagate to consumers.** Audit:
   - `packages/sdk/src/client.ts` (event-aware code paths if any)
   - `services/keeper/src/keeper.ts` and `watch.ts` (idempotent error
     strings, not event names directly, so safe — but verify)
   - `services/agent/src/*` (event names referenced via keeper errors)
   - `apps/web/src/*` (event-driven live views, if any)
   - `docs/RECEIPTS.md` (event surface description)

   Update any docs or agent tests whose expected output embeds the old
   event name.

## Acceptance criteria mapping

| Issue #73 criterion | Where it is satisfied |
| --- | --- |
| Event compatibility drift is caught by tests. | `src/event-snapshot.test.ts` Group 1, 3, 4 — every event is asserted against its snapshot, the JSON golden fixture, and a deterministic decoded payload. Drift on rename, reorder, or drop trips at least one test. |
| Snapshot/update instructions are clear. | This file (`SNAPSHOT_TESTS.md`). |
| Existing contract/bindings tests still pass. | Snapshot tests do not modify the contract or its generated spec, so `cargo test` and any existing TS specs are unchanged. |
| Include at least round created, commit submitted, reveal/settle, refund/cleanup. | `created`, `commit`, `reveal`, `settled`, `voided` are all in `ROUND_EVENT_SNAPSHOT` (Group 2 enforces this). |
| Do not require live Soroban RPC. | Tests run on in-memory fixtures; the helpers take the same decoded shapes that `scValToNative` produces, so there's no host / RPC dependency. |
| Do not change contract events. | The patch is purely additive: contract `lib.rs` is untouched. |

## How the decoder helpers relate to a real RPC event

In the real flow, these helpers run on **decoded** event values (after
`scValToNative` against the XDR fetched from Soroban RPC):

- `topic[0]` is a Soroban Symbol — `symbol_short!(name)` produces a
  9-byte (`Symbol`) value, post-decoded to its ASCII name as a string.
- `topic[1]` is a `u64` round id.
- `data` is the tuple `(field1, field2, …)` in the exact order the
  contract emitted it, post-decoded to native JS shapes (`bigint`,
  `string` for Address, `boolean`, …).

The test fixtures hand-build structures in that same post-decoded shape
so the helpers can be exercised without ever talking to a live RPC node.

If you need to extend these helpers to handle a new native type
emitted by the contract (e.g. `Bytes` in a future event), add a new
`TopicElement` / `DataField` variant and an assertion in
`Group 3` of the test file.
