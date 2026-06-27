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

## Preflight before submit

Every mutating `SubRosaClient` method has a matching `preflight*` helper that
simulates the same call without signing or submitting. Use this to check whether
create, commit, reveal, clear, settle, and void are likely to succeed and to
read estimated resource fees before asking a wallet to sign.

```ts
import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  rpcUrl,
  networkPassphrase,
  contractId,
  publicKey, // secretKey not required for preflight
});

const preflight = await client.preflightCommit({
  roundId,
  sealed,
  escrow,
  bidder,
});

if (!preflight.ok) {
  if (preflight.kind === "contract") {
    console.error(
      preflight.error.contractErrorName,
      preflight.error.contractErrorCode,
    );
  } else {
    console.error(preflight.error.message);
  }
  return;
}

console.log("estimated min resource fee:", preflight.resources.minResourceFee);
await client.commit({ roundId, sealed, escrow, bidder });
```

Preflight helpers return a typed `PreflightResult`:

- `ok: true` with the simulated return value and `resources.minResourceFee`
- `ok: false` with `kind: "contract"` and a decoded `SubRosaContractError`
- `ok: false` with `kind: "rpc"` when Soroban RPC simulation fails
- `ok: false` with `kind: "malformed"` when the simulation payload is unusable

Existing submit methods are unchanged; call them only after preflight succeeds
(or when you intentionally skip the check).

After Drand round `R` is published, any keeper or participant can submit the
Drand signature, reveal valid entries, clear the round, and settle escrow.

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
