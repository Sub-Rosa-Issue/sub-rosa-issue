# Sub Rosa Round — Contract Error Codes

Every failure mode from the Sub Rosa round contract has a defined code. There
is no silent fallback. This document maps each code returned (or reserved) by
the contract enum `Error` to:

- the contract entry point that produces it,
- the precise trigger condition,
- a user-facing message an SDK or wallet can display,
- the suggested next action an integrator or end user should take.

The numeric code is what surfaces on-chain (e.g. through
`soroban_sdk::Error::contract`); the variant name is the Rust identifier that
the SDK and bindings expose. **Both are part of the public API** and must
stay in sync with `contracts/round/src/types.rs`.

> Guardrail: no error codes are invented here. Every row corresponds to one
> variant of `enum Error` in [`src/types.rs`](src/types.rs). Variants marked
> **reserved** are present in the enum but not currently returned by any code
> path; they are documented because they are exported and integrators may
> see them in future protocol versions.

## Categories

| Range | Category |
| --- | --- |
| 1–4     | Initialization & state lookup |
| 10–22   | Lifecycle & timing |
| 30–39   | Cryptography & validation |

## Initialization & state lookup (1–4)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 1 | `NotInitialized` | `get_config`, every contract function that reads `Config` | Storage read of `GlobalConfig` returned empty (instance key `Config` missing). | The round contract has not been deployed with its configuration. | Confirm the contract address you are calling; make sure the deploy transaction has finalized on the target network. |
| 2 | `AlreadyInitialized` | `__constructor` | A second deploy attempt hit a contract storage entry that already holds a `GlobalConfig`. | The round contract has already been configured. | Do not redeploy. Read the existing configuration via the `get_config` view. |
| 3 | `RoundNotFound` | `get_round`, every entry point that loads a `Round` record | Persistent storage has no `Round(id)`. | No round exists with that id on this contract. | Verify the round id. It may come from a different contract, network, or deployment. |
| 4 | `BidNotFound` | `get_state`, `reveal`, `settle` | Persistent storage has no `State(round_id, bidder_address)`. | That bidder has no bid on this round. | Confirm the bidder address and round id. The bidder may not have called `commit` yet, or may have committed on a different round. |

## Lifecycle & timing (10–22)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 10 | `CommitClosed` | `commit` | `env.ledger().timestamp() > round.commit_deadline`. | The commit window for this round has closed. | Do not retry. The operator must open a new round for new bidders. |
| 11 | `CommitNotClosed` | `open_reveal` | Time of the call is still on or before `commit_deadline`. | The reveal window cannot be opened before the commit window closes. | Retry `open_reveal` once `now > commit_deadline`. |
| 12 | `CommitDeadlineAfterReveal` | `create_round` | `commit_deadline >= time(R)` or `reveal_deadline <= time(R)`. | The commit or reveal deadline is not strictly inside the seal window `(now, time(R))`. | Set `commit_deadline` strictly before `time(R)` (Drand quicknet: `genesis + period × round`). |
| 13 | `RevealNotOpen` | `reveal`, `clear` | `round.status != Status::Revealing`. | The reveal window has not been opened for this round yet. | Submit `open_reveal` with a verifiable Drand signature for round R. If Drand has not produced R yet, wait until `time(R) + grace`. |
| 14 | `RevealAlreadyOpen` | `open_reveal` | `round.status != Status::Open` (e.g. already Revealing, Cleared, Settled, Voided). | This round is past the commit phase. | No action — proceed to reveal, or call `clear` / `settle` as the lifecycle permits. |
| 15 | `RevealWindowClosed` | `reveal` | `env.ledger().timestamp() > round.reveal_deadline`. | The reveal window has closed for this round. | Do not retry the reveal. Any bid whose commit nobody successfully revealed stays marked `valid = false` and contributes no bid. After the deadline, anyone can call `clear`: if a valid reveal won, follow with `settle`; if no valid reveal existed, the round transitions to `Voided` and escrow is refunded via `void`/`refund_all` rather than `settle`. |
| 16 | `RevealStillOpen` | `clear` | `env.ledger().timestamp() <= round.reveal_deadline`. | The reveal window is still open; the round cannot be cleared yet. | Retry `clear` after `now > reveal_deadline`. |
| 17 | `NotCleared` | `settle` | `round.status != Status::Cleared`. | The round has not been cleared yet. | Call `clear` after `reveal_deadline`. If `clear` returned `Some(winner)` the round is now `Cleared` and `settle` is the right next step. If `clear` returned `None` the round has already transitioned to `Voided` with escrow refunded; do not call `settle` again — it will keep returning `NotCleared`. |
| 18 | `AlreadyCleared` | (reserved) | Not currently returned by any code path. | Reserved — the round is already in the Cleared state. | Reserved. If surfaced by a future version: do not retry `clear`. |
| 19 | `AlreadySettled` | (reserved) | Not currently returned by any code path. | Reserved — the round has already been settled. | Reserved. If surfaced by a future version: settlement funds have already moved; do not retry `settle`. |
| 20 | `RoundVoided` | (reserved) | Not currently returned by any code path. | Reserved — the round has been voided. | Reserved. If surfaced by a future version: all escrow has already been refunded; the round is terminal. |
| 21 | `NotVoidable` | `void` | Round is past the `Open` status, or `now <= reveal_deadline + VOID_GRACE` (3600 s). | The round cannot be voided from its current state, or the grace window has not elapsed yet. | Either complete the normal lifecycle, or wait until `reveal_deadline + 1 hour` and try `void` again. |
| 22 | `WrongStatus` | `commit` | `round.status != Status::Open`. | A bid can only be submitted to a round in the Open status. | Start a new round; a Revealing/Cleared/Settled/Voided round no longer accepts commits. |

## Cryptography & validation (30–39)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 30 | `InvalidDrandSignature` | `open_reveal` | BLS12-381 pairing check on `e(sig, -g2) · e(H(m), pk) == 1` returned false. | The Drand threshold signature did not verify on-chain. | Verify the signature source. Wait for the next Drand round, or re-fetch the signature from the official quicknet endpoint. Do not retry with a guessed signature. |
| 31 | `HashMismatch` | `reveal` | `sha256(be16(value) ‖ nonce) != state.commitment`. | The revealed bid does not hash to the committed commitment. | Re-derive `(value, nonce)` from the original sealing preimage that produced `H`. Reveal with the exact preimage; do not retry with arbitrary values. |
| 32 | `AlreadyRevealed` | `reveal` | `state.revealed_value.is_some()`. | A reveal has already been recorded for this bidder on this round. | No action — the recorded reveal stands. Repeated reveals are rejected on purpose to prevent front-running by a third party. |
| 33 | `PayloadTooLarge` | `create_round`, `commit` | One of: `auditor_pubkey.len() > 1024`, `ciphertext.len() > 4096`, `auditor_blob.len() > 2048`. | One of the submitted payloads is larger than the contract's size limit. | Shrink the offending payload: ciphertext ≤ 4096 B, auditor public key ≤ 1024 B, auditor blob ≤ 2048 B. |
| 34 | `InvalidAmount` | `create_round`, `commit` | `reveal_round == 0` (in `create_round`) or `escrow <= 0` (in `commit`). | The amount or value supplied is not positive. | Pass a positive integer; for `create_round`, use `reveal_round != 0` and a future `commit_deadline`. |
| 35 | `BidExceedsEscrow` | (reserved) | Not currently returned by any code path. | Reserved — the revealed bid would exceed the escrowed amount. | Reserved. The current contract already marks a bid invalid if `revealed_value > escrow` (see `BidState::valid`), so escrow refunds at settle. |
| 36 | `DeadlineInPast` | `create_round` | `commit_deadline <= now` (ledger time at submission). | The commit deadline is in the past. | Use a future timestamp; check ledger time at submission, since Drand round R must be strictly after `commit_deadline`. |
| 37 | `NoValidBids` | `settle` | `round.winner` is `None` on a round whose status is `Cleared`. | Round has no winner to settle against. | Investigate: under current behavior the contract transitions to `Voided` (with all escrow refunded) when no valid bid is revealed, so this code should not appear in normal flow. If it does, the round is in an inconsistent state and warrants a manual review. |
| 38 | `RoundFull` | `commit` | `round.bidders.len() >= MAX_BIDDERS` (500). | The round has reached its bidder cap. | Start a new round to accept further bidders. |
| 39 | `InvalidLimit` | `get_bidders_page` | `limit == 0` or `limit > 100`. | Page size must be between 1 and 100 (inclusive). | Pass a `limit` in `[1, 100]`; use `next_cursor` from the previous page to walk larger rounds. |

## How to use this table

- **SDK mapping**: [`packages/sdk/src/errors.ts`](../packages/sdk/src/errors.ts)
  wraps SDK-level failures. A future enhancement is to surface the contract
  error code alongside the `SubRosaSubmitError` to enable this table as the
  UI hint layer.
- **Receipt interpretation**: A round receipt that fails to verify should
  include the contract error code from the failing transaction. Use this
  table verbatim for the user-facing note.
- **Keeper triage**: The keeper daemon ([`services/keeper`](../services/keeper))
  classifies the error from a thrown call as either transient (retry later),
  terminal (skip the round), or config (alert). The "Trigger" column is the
  authoritative input for that classifier.

## Cross-references

- Source enum: [`contracts/round/src/types.rs`](src/types.rs)
- Entry points that produce errors: [`contracts/round/src/lib.rs`](src/lib.rs)
- Storage-layer error mapping: [`contracts/round/src/storage.rs`](src/storage.rs)
- Integration guide: [`docs/INTEGRATION.md`](../docs/INTEGRATION.md)
- Technical design and storage TTLs: [`docs/TECH_DESIGN.md`](../docs/TECH_DESIGN.md)
- Threat model: [`docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md)
