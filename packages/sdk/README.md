# `@sub-rosa/sdk`

TypeScript client for reading and submitting Sub Rosa Round contract calls.

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

## Caching

You can optionally configure a short-lived cache for `getRound` and `getConfig` reads by providing a `cacheTtl` (in milliseconds):

```ts
const client = new SubRosaClient({
  // ... other config
  cacheTtl: 5000, // 5 seconds
});
```

This reduces avoidable RPC load and latency when dashboards or keeper watch loops re-read the same round repeatedly. 

**Tradeoffs**: Reads may be stale for up to `cacheTtl` milliseconds if another client updates the round. However, the client automatically invalidates its own cache for a round when it successfully executes a state-changing write operation (e.g., `commit`, `reveal`, `settle`) for that round.
