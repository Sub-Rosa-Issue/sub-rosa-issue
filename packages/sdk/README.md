# `@sub-rosa/sdk`

TypeScript client for reading and submitting Sub Rosa Round contract calls.

## Bidder enumeration

`client.bidders(roundId)` follows the contract's opaque cursors until `has_more`
is false. Each bidder is yielded once in first-commit order. A repeated bidder
or a page that cannot make consistent progress throws `SubRosaPaginationError`;
consumers must let that error abort the operation rather than use a partial set.
Receipt export uses this iterator too.

For manual paging, call `getBiddersPage(roundId, undefined, limit)` to start,
then pass `page.next_cursor` unchanged while `page.has_more` is true. The first
page fixes a snapshot count, excluding bidders who commit later; restart to
include those bidders. Tokens from another round or contract are rejected.
The [cursor format](../../contracts/round/ERRORS.md#bidder-cursor-encoding-v1)
is versioned and replaces the old numeric-offset ABI, so this SDK requires a
contract deployed with the matching generated bindings.

## Network configuration

Configure the RPC URL, network passphrase, and contract ID from the same deployment:

```ts
import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: process.env.ROUND_CONTRACT_ID!,
  publicKey: process.env.STELLAR_PUBLIC_KEY,
});
```

On the first contract call, the client asks the RPC for its actual network
passphrase and confirms that `contractId` exists on that network. The result is
cached for later calls. A mismatch throws `SubRosaNetworkMismatchError` before
simulation, signing, or submission, with the conflicting values and a suggested
fix. Contract IDs do not encode a Stellar network, so copying a `C...` address
between Testnet and Mainnet requires updating all three configuration values.

## Mainnet readiness (manifest-pinned)

`packages/sdk/mainnet-artifacts.json` is the artifact manifest the repo commits.
`mainnet:ready` and `mainnet:verify` both load it and compare the live deployment
against it through the read-only client:

| manifest field   | compared against                                             |
| ---------------- | ------------------------------------------------------------ |
| `contractId`     | the contract the client is bound to                          |
| `networkPassphrase` | the passphrase the RPC reports (`getNetwork`)             |
| `wasmHash`       | the executable hash read from the contract ledger entry      |
| `tokenContract`  | `usdc` in the deployed `GlobalConfig` (the escrow SAC)        |

Any disagreement blocks, and a field that cannot be read at all blocks too — an
unverifiable field must never read as a pass. The report names the field and
prints a redacted value: passphrases become a short sha256 fingerprint, and
anything shaped like an `S...` secret key is redacted outright. The configured
passphrase and contract id are compared with the manifest before any RPC call,
so pointing `NETWORK_PASSPHRASE` at testnet fails instead of reporting a green
check against the wrong network.

```ts
import {
  assertDeploymentMatches,
  defaultMainnetReadinessInput,
  readLiveDeployment,
  runMainnetReadiness,
} from "@sub-rosa/sdk";

// Live: throws SubRosaDeploymentMismatchError naming every disagreeing field.
assertDeploymentMatches(manifest, await readLiveDeployment(client, server, contractId, fetchHash));

// Full report, or a replay of a recorded snapshot with no RPC at all:
const report = await runMainnetReadiness(
  defaultMainnetReadinessInput({ fixture: recordedSnapshot }),
);
```

Readiness never needs a secret key: the client is read-only and balance checks
take public keys (`OPERATOR_PUBLIC_KEY`, `KEEPER_PUBLIC_KEY`, `BIDDER_PUBLIC_KEY`).

## Commands

```bash
pnpm mainnet:ready -- --strict                                      # live, read-only
pnpm mainnet:ready -- --fixture packages/sdk/fixtures/mainnet-readiness.json  # CI-safe
pnpm mainnet:verify                                                 # settlement proof + manifest
```

`--fixture` replays a recorded deployment through the same comparison with no
mainnet RPC, so CI can prove each mismatch field fails and a matching recording
passes.
