<!-- SPDX-License-Identifier: MIT -->
# Integrating Sub Rosa

Sub Rosa does not require users to come to the Sub Rosa demo app. The demo app
is a showcase. The intended product surface is a Soroban contract plus
TypeScript packages that auction and competitive-bid apps can embed.

## Target integration

```bash
npm install @sub-rosa/sdk @sub-rosa/tlock
```

`@sub-rosa/sdk` is already present in this monorepo as `packages/sdk`. Publishing
to npm is a release step, not a protocol requirement.

## What an app integrates

An integrating app usually needs four pieces:

| Piece | Role |
| --- | --- |
| Round contract | Stores commitments, ciphertext, escrow, deadlines, Drand R, reveal state |
| `@sub-rosa/sdk` | Creates rounds and submits contract calls from app backend/frontend |
| `@sub-rosa/tlock` | Seals values to Drand R and opens ciphertext after R |
| Keeper | Opens reveal and settles when Drand R is live; permissionless by design |

## Minimal flow

```ts
import { SubRosaClient } from "@sub-rosa/sdk";
import { generateNonce, quicknet, sealBid } from "@sub-rosa/tlock";

const drand = quicknet();
const client = new SubRosaClient({
  rpcUrl,
  networkPassphrase,
  contractId,
  secretKey,
});

const sealed = await sealBid({
  value,
  nonce: generateNonce(),
  round: revealRound,
  client: drand,
  identity,
  auditorPublicKey,
});

await client.commit({
  roundId,
  sealed,
  escrow,
});
```

After Drand round `R` is published, any keeper or participant can submit the
Drand signature, reveal valid bids, clear the auction, pay the operator from
winner escrow, and refund losing escrow.

## Preflight simulation

Before signing and submitting a state-changing call, integrators can simulate
the transaction against Soroban RPC to see whether it is likely to succeed:

```ts
const preflight = await client.preflightCommit({
  roundId,
  sealed,
  escrow,
});

if (!preflight.ok) {
  if (preflight.error.kind === "contract_error") {
    logger.error(
      "contract-rejected-commit",
      "Contract rejected commit",
      { message: preflight.error.contractErrorMessage }
    );
  } else {
    logger.error("preflight-failed", "Preflight simulation failed", { error: preflight.error.message });
  }
  return;
}

logger.info("estimated-fee", "Estimated fee", { transactionFee: preflight.fee.transactionFee, minResourceFee: preflight.fee.minResourceFee?.toString() });

await client.commit({ roundId, sealed, escrow });
```

Each mutating `SubRosaClient` method has a matching `preflight*` helper:

| Submit | Preflight |
| --- | --- |
| `createRound` | `preflightCreateRound` |
| `commit` | `preflightCommit` |
| `openReveal` | `preflightOpenReveal` |
| `reveal` | `preflightReveal` |
| `clear` | `preflightClear` |
| `settle` | `preflightSettle` |
| `void` | `preflightVoid` |

Preflight results include:

- `ok` — whether simulation indicates the call would succeed
- `fee` — estimated transaction and minimum resource fees when available
- `resources` — CPU/memory footprint estimates when available
- `error` — typed `SubRosaPreflightError` for RPC failures, simulation errors,
  expired contract state, or decoded Round contract error codes

Existing submit methods are unchanged; preflight is optional and does not
require live signing credentials beyond a source `publicKey` (or `secretKey`).

## Auditor identity recovery CLI

For pilots that need machine-readable selective-disclosure evidence, recover
bidder identities from auditor blobs with:

```bash
pnpm --filter @sub-rosa/tlock recover:identities -- \
  --auditor-secret-hex <32-byte-hex> \
  --input-json '{"auditor":{"blobs":{"agent-alpha":"<blob-hex>"}}}'
```

Hex-only input (single blob):

```bash
pnpm --filter @sub-rosa/tlock recover:identities -- \
  --auditor-secret-hex <32-byte-hex> \
  --blob-hex <blob-hex> \
  --label agent-alpha
```

### Identity binding

Auditor blobs produced by `sealBid` and `sealPayload` are bound to the bid they
were sealed with: the round and the bid commitment travel inside the encrypted
payload. Recovery should therefore pass both, so the CLI can prove the
recovered identity is the one committed with the seal:

```bash
pnpm --filter @sub-rosa/tlock recover:identities -- \
  --auditor-secret-hex <32-byte-hex> \
  --blob-hex <blob-hex> \
  --round 7777 \
  --commitment-hex <32-byte-hex>
```

Without these flags a blob sealed by `sealBid`/`sealPayload` is refused, because
printing its contents would disclose an identity that has not been tied to a
bidder. A blob carrying the older unbound format (produced by the lower-level
`sealIdentity`) still recovers without them, since there is no binding to check.

When the binding does not hold, the row carries an error and **no** identity is
printed:

| Situation | Error |
| --- | --- |
| Blob sealed for another bidder in the same round | `auditor blob identity commitment mismatch` |
| Blob from a different round | `auditor blob round mismatch` |
| Bound blob recovered without `--round`/`--commitment-hex` | `auditor blob is identity-bound but --round and --commitment-hex were not supplied` |
| Truncated or non-hex blob | rejected while parsing, before decryption |

`--round` and `--commitment-hex` must be supplied together; either alone is
rejected as bad input.

Canonical trace JSON is supported as well, including shapes like
`{"trace":{"auditor":{"blobs":{...}}}}` and
`{"auditor":{"blobs":{...}}}` exported from lifecycle/agent fixtures.

Output is JSON and always includes per-blob rows with either recovered identity
or an error. Invalid required inputs return `{ "ok": false, ... }` and exit
non-zero.

## Primary use case

The focused integration target is an escrow-backed sealed auction:

- bids remain unreadable before close;
- the winning bid is paid from escrow;
- losers are refunded deterministically;
- the operator cannot read bids early or choose who settles;
- the final receipt is public and verifiable.

Future templates can adapt the same primitive to grants, judging, RFPs, DAO
polls, or allocation workflows, but those do not lead the current SCF
resubmission.

## Sealed-auction template

`services/auction-template` is the runnable integration template. It is a
**thin caller of the shared rules** — it defines no lifecycle of its own:

- **Phase decisions** come from the SDK round-status helpers
  (`packages/sdk/src/round-status.ts`).
- **Settlement safety** comes from the escrow conservation preflight
  (`packages/sdk/src/preflight.ts` powers the simulation; the template's
  conservation check mirrors the receipt verifier's invariant).
- **Round binding** comes from the seal's Drand round: a bid sealed for any
  round other than the round's `revealRound` is refused before commit.

Entry points:

| File | Role |
| --- | --- |
| `sealed-auction.ts` | Runnable lifecycle: `FIXTURE=1` replays the offline golden receipt; without it, the full testnet run (requires funded keys + `WASM_HASH`) |
| `template-rules.ts` | Pure, offline-testable guards every entry point shares: `templatePhaseGate` (SDK phase predicates), `checkEscrowConservation` (settle preflight), `checkSealRound` (seal/Drand-round binding) |
| `sealed-auction.smoke.test.ts` | Offline smoke: fixture shape, commitment hashes, winner derivation, template guards, and the full happy-path fixture settle — no live network |

The guards are intentionally boring: `templatePhaseGate` maps the SDK's
`RoundStatus` vocabulary to the one question an integrator has — *may I
reveal / clear / settle right now?* — and refuses with a reason otherwise.
Integrators should copy the guards, not the lifecycle wiring.

## Hosted vs embedded

| Mode | Who uses it | Notes |
| --- | --- | --- |
| Embedded SDK | Stellar app developers | App owns UI and user flow |
| Hosted keeper | Apps that want liveness without running ops | Keeper cannot read early values; it only opens after R |
| Demo frontend | Reviewers, pilots, onboarding | Shows the primitive working end-to-end |

## Trust model

Sub Rosa does not ask integrators to trust a reveal operator. Before Drand R,
values are timelock-encrypted. After R, the Drand BLS signature is public and
the Soroban contract verifies it before opening reveal.

## Contract error codes

Every failure mode from the round contract is returned (or reserved) as a
defined code with no silent fallbacks. When a transaction surfaces a
`soroban_sdk::Error::Contract(code)`, the canonical mapping — variant name,
trigger condition, user-facing message, and suggested next action — lives in:

[`contracts/round/ERRORS.md`](../contracts/round/ERRORS.md)

UI layers, receipt exporters, and keeper triage logic should consult that
table to translate on-chain failures into actionable messages. The contract
test suite (`cargo test -p sub-rosa-round ::error_codes`) keeps the table in
lock-step with the exported `Error` enum, so a divergent code is a test
failure, not a silent docs bug.

## SDK error codes

`sdkErrorCode(error)` maps anything thrown by the SDK to a member of
`SDK_ERROR_CODES` (type `SdkErrorCode`), for example `STATUS_API_ERROR`,
`PREFLIGHT_FAILED` or `TRANSACTION_TIMEOUT`. Classification is by error class
only; values the SDK did not raise map to `UNKNOWN`. Because the set is closed
and no property of the thrown value is read, a code is safe to render where
error messages are not — the dashboard error state shows only this code, so a
failed load cannot display a bid that is still sealed.
