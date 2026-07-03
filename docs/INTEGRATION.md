# Integrating Sub Rosa

Sub Rosa does not require users to come to the Sub Rosa demo app. The demo app
is a showcase. The intended product surface is a Soroban contract plus
TypeScript packages that other Stellar apps can embed.

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
Drand signature, reveal valid entries, clear the round, and settle escrow.

## Grant scoring pilot template

For SCF-style sealed grant scoring (multiple projects, panel judges, ranked
receipt output), see [`examples/grant-scoring`](../examples/grant-scoring/README.md).
It uses the same `@sub-rosa/sdk` + `@sub-rosa/tlock` commit path as above but
models the full grant lifecycle separately from the jury demo trace.

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

Canonical trace JSON is supported as well, including shapes like
`{"trace":{"auditor":{"blobs":{...}}}}` and
`{"auditor":{"blobs":{...}}}` exported from lifecycle/agent fixtures.

Output is JSON and always includes per-blob rows with either recovered identity
or an error. Invalid required inputs return `{ "ok": false, ... }` and exit
non-zero.

## Allocation use cases

- SCF-style grant allocation: judges cannot react to leaked scores
- Hackathon judging: panel scores open together after judging closes
- Bounty distribution: reviews and allocation inputs stay sealed
- RFP scoring: vendors and evaluators cannot tune inputs from visible competitors
- Sealed auctions: bids remain unreadable before close
- DAO/community allocation: demand signals and ballots do not leak during the window

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
