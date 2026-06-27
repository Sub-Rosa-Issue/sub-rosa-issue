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

## Contract artifacts

Integrators need a reproducible way to know which WASM, contract ID, bindings,
and network metadata belong together. The repo ships a versioned manifest at
`deployments/artifact-manifest.json` with:

- WASM hash and ContractSpec hash for the current build
- Generated bindings path and regeneration command
- Network passphrases and RPC URLs for local, testnet, and mainnet
- Known contract IDs for canonical proof deployments (when available)

After changing `contracts/round/`, maintainers run:

```bash
pnpm bindings:generate   # rebuild WASM, regenerate bindings, refresh manifest
pnpm bindings:check      # verify committed artifacts match the build
```

Commit the updated bindings and manifest together. CI fails with a clear message
when contract source changes without regenerating artifacts.
