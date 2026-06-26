# SDK Recipes

Copy-paste examples for the most common Sub Rosa integration patterns.
Each snippet is self-contained: fill in the constants at the top and run.

---

## Recipe: Create a round and commit a sealed bid

This is the core integration path. An operator creates a round (once), then
each bidder seals a value locally and commits it on-chain — all before the
Drand reveal round `R` is reached.

```ts
import { SubRosaClient } from "@sub-rosa/sdk";
import { generateNonce, quicknet, roundInSeconds, sealBid } from "@sub-rosa/tlock";

// ── 1. Configuration ──────────────────────────────────────────────────────

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "<your-deployed-round-contract-C…>";

// Operator and bidder secret keys (S…).  Keep these out of source control.
const OPERATOR_SECRET = process.env.OPERATOR_SECRET!;
const BIDDER_SECRET = process.env.BIDDER_SECRET!;

// Off-chain item reference: sha256 (or any 32-byte opaque tag) of what is
// being bid on — a grant, bounty description, or auction item hash.
const ITEM_REF = new Uint8Array(32).fill(0xab); // replace with real hash

// Auditor key (32-byte Ed25519 public key) for selective disclosure.
// Identities are encrypted to this key so only the auditor can deanonymise.
const AUDITOR_PUBKEY = new Uint8Array(32).fill(0xcd); // replace with real key

// ── 2. Seal window: how far in the future the bids unlock ─────────────────

const SEAL_SECONDS = 120; // bids are locked for ~2 minutes

// ── 3. Create the round (operator) ───────────────────────────────────────

const drand = quicknet();

// The reveal round R is the Drand round that will be live ~SEAL_SECONDS from now.
const revealRound = await roundInSeconds(drand, SEAL_SECONDS);

const operatorClient = new SubRosaClient({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  contractId: CONTRACT_ID,
  secretKey: OPERATOR_SECRET,
});

const now = Math.floor(Date.now() / 1000);

const roundId = await operatorClient.createRound({
  itemRef: ITEM_REF,
  revealRound,
  commitDeadline: now + SEAL_SECONDS - 30, // close commits 30 s before R
  revealDeadline: now + SEAL_SECONDS + 300, // reveals open for 5 min after R
  auditorPubkey: AUDITOR_PUBKEY,
  clearingRule: "HighestBid", // or "LowestBid" for RFP / grant scoring
});

console.log(`Round created: id=${roundId}, R=${revealRound}`);

// ── 4. Seal and commit (bidder) ───────────────────────────────────────────

const bidValue = 700n; // token units (e.g. stroops, USDC micro-units)
const escrow = 700n;   // on-chain budget locked with the commitment
const nonce = generateNonce(); // cryptographically random 32-byte nonce

// Identity blob (optional): the bidder's address or any bytes that the
// auditor should be able to decrypt after reveal.
const identity = new TextEncoder().encode("bidder@example.com");

const sealed = await sealBid({
  value: bidValue,
  nonce,
  round: revealRound,
  client: drand,
  identity,
  auditorPublicKey: AUDITOR_PUBKEY,
});

const bidderClient = new SubRosaClient({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  contractId: CONTRACT_ID,
  secretKey: BIDDER_SECRET,
});

await bidderClient.commit({ roundId, sealed, escrow });

console.log(`Committed: roundId=${roundId}, H=${Buffer.from(sealed.commitment).toString("hex")}`);
```

### What happens next

After Drand round `R` is published, the keeper (or any participant) runs:

```ts
import { fetchRoundSignature } from "@sub-rosa/tlock";

const sig = await fetchRoundSignature(drand, revealRound);
await bidderClient.openReveal(roundId, sig);   // verifies BLS on-chain

// Reveal: bidder discloses the plaintext value + nonce
await bidderClient.reveal({ roundId, bidder: "<BIDDER_G…>", value: bidValue, nonce });

// Operator clears and settles
const winner = await operatorClient.clear(roundId);
await operatorClient.settle(roundId);
console.log("Winner:", winner);
```

Use `pnpm keeper:watch` or `pnpm lifecycle:e2e` to run the full lifecycle
on testnet automatically.

---

## Key types quick-reference

| Symbol | Package | Purpose |
|---|---|---|
| `SubRosaClient` | `@sub-rosa/sdk` | On-chain create / commit / reveal / settle |
| `sealBid` | `@sub-rosa/tlock` | Timelock-encrypt value+nonce to Drand R |
| `generateNonce` | `@sub-rosa/tlock` | Cryptographic 32-byte random nonce |
| `quicknet` | `@sub-rosa/tlock` | Drand quicknet client (3 s rounds) |
| `roundInSeconds` | `@sub-rosa/tlock` | Map a duration to a future Drand round |
| `fetchRoundSignature` | `@sub-rosa/tlock` | Fetch the 96-byte G1 sig for `open_reveal` |

See [INTEGRATION.md](./INTEGRATION.md) for the full trust model and use-case overview.
