# Integrating Sub Rosa

Sub Rosa does not require users to come to the Sub Rosa demo app. The demo app
is a showcase. The intended product surface is a Soroban contract plus
TypeScript packages that other Stellar apps can embed.

This guide walks you through embedding Sub Rosa from scratch — installing the
packages through to exporting a verified settlement receipt.

---

## Prerequisites

Before you start, make sure you have:

- **Node.js >= 22** and **pnpm** (or npm / yarn)
- **A Stellar account** with testnet (or mainnet) funds
  - Testnet: fund via the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=testnet)
  - Mainnet: a funded account with XLM for contract deploy fees
- **Drand quicknet access** (public — no key required)
- **Soroban RPC endpoint** — defaults to `https://soroban-testnet.stellar.org` (testnet) or
  `https://mainnet.sorobanrpc.com` (mainnet)

> **Testnet vs Mainnet:** Testnet uses fake USDC (`SAC`) and the Friendbot for
> free XLM. Everything in this walkthrough works identically on both networks
> — only the RPC URL, network passphrase, and contract ID change. Run through
> testnet first to validate the flow before touching mainnet.

---

## 1. Install the packages

```bash
npm install @sub-rosa/sdk @sub-rosa/tlock
```

Or from the monorepo (if you're working inside this repo):

```bash
pnpm add @sub-rosa/sdk @sub-rosa/tlock
```

What you get:

| Package | Role |
| --- | --- |
| `@sub-rosa/sdk` | `SubRosaClient` — creates rounds, commits, reveals, clears, settles, exports receipts |
| `@sub-rosa/tlock` | `sealBid` / `openBid` — timelock-encrypts values to a future Drand round; generates nonces, commitments, and auditor identity blobs |

---

## 2. Configure the SDK client

Every state-changing call on the Round contract needs a funded Stellar account.
Create the client with an RPC endpoint, network passphrase, deployed contract ID,
and secret key.

```ts
import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "<DEPLOYED_CONTRACT_ID>", // testnet: deploy your own (see §3); mainnet: CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX
  secretKey: "S…",
});
```

| Config | Required | Notes |
| --- | --- | --- |
| `rpcUrl` | Yes | Soroban RPC endpoint |
| `networkPassphrase` | Yes | `"Test SDF Network ; September 2015"` for testnet |
| `contractId` | Yes | Deployed Round contract address (starts with `C`) |
| `secretKey` | No* | Required for state-changing calls; omit for read-only |
| `publicKey` | No | Used as simulation source when `secretKey` is absent |
| `submitter` | No | Optional [OZ Relayer Channels](https://docs.openzeppelin.com/relayer/channels) submitter |

*Read-only calls (`getRound`, `getBidState`, `getBidders`) work without a secret key.

---

## 3. Deploy the Round contract (one-time)

Before any round can be created, the Round Soroban contract must be deployed.
You need the compiled WASM hash and four Drand parameters.

```ts
import { RoundContract } from "@sub-rosa/sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair } from "@stellar/stellar-sdk";

// Drand quicknet constants (these never change)
const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DRAND_PUBKEY = "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const DRAND_NEGGEN = "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";

const operatorKeypair = Keypair.fromSecret("S…");
const hex = (s: string) => Buffer.from(s, "hex");

const deployTx = await RoundContract.deploy(
  {
    drand_pubkey: hex(DRAND_PUBKEY),
    g2_neg_generator: hex(DRAND_NEGGEN),
    dst: Buffer.from(DST, "utf8"),
    drand_genesis: BigInt(DRAND_GENESIS),
    drand_period: BigInt(DRAND_PERIOD),
    usdc: "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y", // testnet USDC SAC (C-prefix contract ID, not the G-prefix issuer)
  },
  {
    wasmHash: "<WASM_HASH>",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    publicKey: operatorKeypair.publicKey(),
    signTransaction: basicNodeSigner(operatorKeypair, "Test SDF Network ; September 2015").signTransaction,
  },
);
const contractId = (await deployTx.signAndSend()).result.options.contractId;
console.log("Contract deployed:", contractId);
```

> **One deploy per protocol instance.** Once the contract is on-chain, you create
> many rounds against it — you do not redeploy per round. The WASM hash comes
> from a compiled `sub_rosa_round.wasm` (build with `pnpm contract:build`).

---

## 4. Create a round

Pick a future Drand round `R` (the value stays sealed until this round is
published). Set commit and reveal deadlines, then create the round.

```ts
import { createHash } from "node:crypto";
import { generateAuditorKeypair, quicknet } from "@sub-rosa/tlock";

const drand = quicknet();
const auditor = generateAuditorKeypair();  // for optional identity recovery

const now = Math.floor(Date.now() / 1000);
const revealRound = Math.ceil((now + 135 - DRAND_GENESIS) / DRAND_PERIOD);
const tReveal = DRAND_GENESIS + DRAND_PERIOD * revealRound;

const roundId = await client.createRound({
  itemRef: createHash("sha256").update("my-auction-item").digest(),
  revealRound,
  commitDeadline: now + 75,        // 75s to submit sealed bids
  revealDeadline: tReveal + 120,   // 120s after R to reveal
  auditorPubkey: auditor.publicKey,
  clearingRule: "HighestBid",      // or "LowestBid"
});

console.log(`Round ${roundId} created (R=${revealRound})`);
```

**Key parameters:**

| Parameter | Description |
| --- | --- |
| `itemRef` | 32-byte reference (usually `sha256` of an item description). Opaque to the contract — it's just bytes. |
| `revealRound` | Drand quicknet round whose BLS signature unlocks the reveal window. Pick one ~135s in the future, computed as `ceil((now + 135 - genesis) / period)`. |
| `commitDeadline` | Unix seconds — must be before `time(R)`. Bids after this are rejected. |
| `revealDeadline` | Unix seconds — must be after `time(R)`. Reveals after this are rejected. |
| `auditorPubkey` | X25519 public key for encrypting bidder identities (selective disclosure). |
| `clearingRule` | `"HighestBid"` (first-price sealed-bid) or `"LowestBid"`. |

---

## 5. Seal and commit a bid

Each bidder timelock-encrypts their bid to Drand round `R` and submits the
sealed commitment + ciphertext + escrow to the contract.

```ts
import { generateNonce, sealBid } from "@sub-rosa/tlock";

const nonce = generateNonce();   // 32 random bytes
const bidValue = 300_000_000n;   // 30 USDC (7-decimal)
const escrow = 500_000_000n;     // 50 USDC (≥ bid)

const sealed = await sealBid({
  value: bidValue,
  nonce,
  round: revealRound,
  client: drand,
  identity: new TextEncoder().encode("bidder:alice"),
  auditorPublicKey: auditor.publicKey,
});

// Preflight (simulate without submitting)
const preflight = await client.preflightCommit({ roundId, sealed, escrow });
if (!preflight.ok) {
  console.error("Commit would fail:", preflight.error.contractErrorMessage);
  process.exit(1);
}

// Submit for real
await client.commit({ roundId, sealed, escrow });
console.log("Bid committed");
```

**What `sealBid` produces:**

```ts
interface SealedBid {
  commitment: Uint8Array;   // sha256(be16(value) || nonce) — stored on-chain
  ciphertext: Uint8Array;   // tlock(preimage, R) — age-armored ciphertext
  auditorBlob: Uint8Array;  // encrypted bidder identity (empty if no identity given)
}
```

⚠️ The escrow amount must be **greater than or equal to** the bid value.
Under-escrowed bids are marked invalid at clear time and cannot win.

Repeat this step for every bidder. Each bidder signs with their own Stellar
account.

---

## 6. The keeper: open reveal and decrypt all bids

Once Drand round `R` is published (automatically ~135s after creation), a
**permissionless keeper** can force the reveal open and decrypt every seal.
Any account can act as the keeper — no special role is needed.

```ts
import { keepRound, closeRound } from "@sub-rosa/keeper";
// or implement the logic yourself with the SDK and tlock:

// 6a. Wait for R and fetch the Drand BLS signature
import { fetchRoundSignature } from "@sub-rosa/tlock";

const signature = await fetchRoundSignature(drand, revealRound);

// 6b. Open the reveal window (contract verifies BLS on-chain)
await client.openReveal(roundId, signature);
console.log("Reveal window opened");

// 6c. Read the deterministic bidder index
const bidders: string[] = [];
for await (const addr of client.bidders(roundId)) bidders.push(addr);

// 6d. Decrypt and reveal each bid
import { openBid } from "@sub-rosa/tlock";

for (const bidder of bidders) {
  const seal = await client.getSeal(roundId, bidder);
  if (!seal) {
    console.log(`  ${bidder}: seal expired`);
    continue;
  }

  const opened = await openBid(new Uint8Array(seal.ciphertext), drand);

  await client.reveal({
    roundId,
    bidder,
    value: opened.value,
    nonce: opened.nonce,
  });
  console.log(`  ${bidder}: revealed ${opened.value}`);
}
```

> The keeper is **idempotent** — all contract operations handle "already done"
> states gracefully. Multiple keepers can run on the same round without
> conflicts.

---

## 7. Clear and settle

After the reveal deadline has passed, the round can be **cleared** (determine
winner) and **settled** (transfer escrow).

```ts
// 7a. Clear — contract picks the winner deterministically
const winner = await client.clear(roundId);
if (winner === undefined) {
  console.log("No valid bids — round voided, escrows refunded");
} else {
  console.log(`Winner: ${winner}`);
}

// 7b. Settle — transfers the winning bid to the operator,
//     refunds all other bidders
await client.settle(roundId);
console.log("Round settled");
```

**Clearing rules:**

| Rule | Winner |
| --- | --- |
| `"HighestBid"` | The bid with the highest revealed value. Ties go to the bidder who appears first in the on-chain index (which is deterministic — first bid to arrive wins). |
| `"LowestBid"` | The bid with the lowest revealed value (useful for sealed RFPs). |

On clear:
- Bids whose escrow < revealed value are marked invalid
- Under-revealed bidders (committed but never revealed) have no valid entry
- The round becomes **Voided** if no valid bids exist — all escrow is refunded

On settle:
- Winner's escrow → winner pays their bid, the rest is refunded
  - Winner's escrow = `escrow - winningValue` refunded, `winningValue` sent to operator
- Losers' full escrow refunded
- Contract balance returns to **0**

---

## 8. Export and verify a receipt

After settlement, export a portable signed receipt and verify it offline.

```ts
// Export — reads all on-chain state into a single JSON document
const receipt = await client.exportReceipt(roundId);
console.log(`Receipt: winner=${receipt.winner}, status=${receipt.status}`);

// Serialize to canonical JSON
import { serializeReceipt, verifyReceipt } from "@sub-rosa/sdk";

const json = serializeReceipt(receipt);
// Save to file, send to auditor, etc.

// Verify offline — no RPC, no secrets, no Stellar dependency
const result = verifyReceipt(receipt);
if (result.valid) {
  console.log("✓ Receipt verified — all commitments bind, winner matches");
} else {
  for (const issue of result.issues) {
    console.error(`  ${issue.severity}: [${issue.code}] ${issue.message}`);
  }
}
```

**What the offline verifier checks:**

| Check | What it catches |
| --- | --- |
| Schema version | Outdated or malformed receipts |
| Network fingerprint | Tampered `network` field (detected via embedded `sha256(network)`) |
| Commitment binding | Every revealed value + nonce recomputed against the stored `sha256` |
| Winner selection | Declared winner recalculated from valid revealed bids |
| Evidence hex format | Ciphertext/auditorBlob format warnings |

For full details see [RECEIPTS.md](./RECEIPTS.md).

---

## Full lifecycle script (copy-paste)

The complete zero-to-settlement example lives in
[`services/auction-template/sealed-auction.ts`](../services/auction-template/sealed-auction.ts).
It runs in two modes:

**Fixture mode** (offline, no network):
```bash
FIXTURE=1 node --import tsx services/auction-template/sealed-auction.ts
```

**Testnet mode** (real RPC, needs env vars):
```bash
# Set these in your environment or .env:
#   OPERATOR_SECRET, BIDDER1_SECRET, BIDDER2_SECRET, KEEPER_SECRET
#   WASM_HASH, USDC_SAC
node --import tsx services/auction-template/sealed-auction.ts
```

The script walks through every phase — deploy, create round, seal + commit,
keeper reveal, clear, settle, export receipt, offline verify — with real
USDC transfers.

---

## Using the keeper service

For production, run the keeper as a long-lived service that watches configured
rounds and automatically opens, reveals, and closes them from inside the
monorepo:

```bash
# From the monorepo root, run in watch mode (polls Drand + contract every 15s)
KEEPER_SECRET=S… \
  ROUND_CONTRACT_ID=C… \
  WATCH_ROUND_IDS=1,2,5 \
  pnpm keeper:watch
```

The keeper is **permissionless** — it cannot read sealed values and only acts
after Drand publishes round R. It is also **idempotent**: re-running on an
already-settled round is harmless.

```ts
import { keepRound, closeRound, watchRound, voidIfStale } from "@sub-rosa/keeper";

// One-shot: wait for R, open, reveal all
await keepRound({ sdk: client, drand, maxWaitSeconds: 240, log: console.log }, roundId);

// One-shot: clear + settle (after reveal deadline)
await closeRound({ sdk: client, drand, log: console.log }, roundId);

// Combined watch tick: void-if-stale → keep → close
const tick = await watchRound({ sdk: client, drand, log: console.log }, roundId);
console.log(`Round ${tick.roundId}: ${tick.finalStatus}`);
```

---

## Environment and key notes

### Required for state-changing operations

| Variable | Example (testnet) | Purpose |
| --- | --- | --- |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Network identifier |
| `ROUND_CONTRACT_ID` | `CA7KS…` | Deployed contract |
| `SECRET_KEY` | `S…` | Signing account |
| `WASM_HASH` | 64-char hex | Contract WASM hash for deploy |

### USDC addresses

| Network | USDC SAC |
| --- | --- |
| Testnet | `CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y` |
| Mainnet | Native XLM SAC (used by the mainnet smoke round) |

### Drand quicknet (always public)

| Parameter | Value |
| --- | --- |
| Chain hash | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| API URL | `https://api.drand.sh` |
| Genesis | `1692803367` |
| Period | `3` seconds |
| Hash function | `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_` |

---

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

---

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
`{"auditor":{"blobs":{...}}}}` exported from lifecycle/agent fixtures.

Output is JSON and always includes per-blob rows with either recovered identity
or an error. Invalid required inputs return `{ "ok": false, ... }` and exit
non-zero.

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
    console.error(
      "Contract rejected commit:",
      preflight.error.contractErrorMessage,
    );
  } else {
    console.error("Preflight failed:", preflight.error.message);
  }
  return;
}

console.log("Estimated fee (stroops):", preflight.fee.transactionFee);
console.log("Min resource fee:", preflight.fee.minResourceFee?.toString());

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

## Receipt redaction for public demos

The SDK includes `redactReceipt` for producing public-safe receipt copies:

```ts
import { redactReceipt, serializeReceipt, parseReceipt } from "@sub-rosa/sdk";

const redacted = redactReceipt(receipt);
// write redacted to disk, embed in demo output, etc.
```

See [RECEIPTS.md](./RECEIPTS.md) for full redaction options and deterministic
output guarantees.
