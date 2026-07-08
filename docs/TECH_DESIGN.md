# Sub Rosa — Technical Design

## Architecture

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the system overview. This document covers cryptography, storage, and settlement detail.

## Overview

Sub Rosa is a **sealed commit–reveal coordination primitive** on Stellar Soroban. Participants lock escrow and submit timelock-encrypted bids; a public Drand round R forces simultaneous decryption; the contract clears and settles deterministically.

## Architecture

```
┌─────────────┐     sealBid (tlock)      ┌──────────────────┐
│ Bidder /    │ ───────────────────────► │ Round contract   │
│ Agent       │     commit(H,C,blob)     │ (Soroban)        │
└─────────────┘                          └────────┬─────────┘
       │ x402 appraisal                           │
       ▼                                          │ open_reveal(BLS sig)
┌─────────────┐                          ┌────────▼─────────┐
│ Appraisal   │                          │ Keeper (anyone)  │
│ API         │                          │ reveal → clear   │
└─────────────┘                          │ → settle         │
                                           └──────────────────┘
```

### Packages

| Package | Role |
| --- | --- |
| `contracts/round` | Soroban Round — storage, BLS verify, SAC settle |
| `packages/tlock` | Off-chain seal: `sealBid` / `openBid`, auditor blob |
| `packages/sdk` | `SubRosaClient` — bindings + direct RPC or optional OZ Channels submit |
| `services/keeper` | Permissionless open/reveal/clear/settle (+ watch mode) |
| `services/appraisal-api` | x402-gated appraisal (SEP-41 USDC) |
| `services/agent` | Multi-agent bidders with session mandates |
| `apps/web` | Jury demo UI |

## Cryptography

### Timelock seal (bid values)

- Scheme: Drand quicknet `bls-unchained-g1-rfc9380` via `tlock-js`
- Preimage: `be16(value) ‖ nonce` (32 bytes)
- Commitment: `H = sha256(preimage)` verified in-contract at reveal
- Unlock: round-R threshold signature verified on-chain (BLS12-381 host fns)

### Auditor blob (bidder identity)

- X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305
- Stored in temporary contract storage alongside ciphertext
- Only the round's designated auditor secret can decrypt

### On-chain BLS

Deploy constants validated via `services/drand-tools` against live quicknet. Contract rejects wrong-round signatures and malformed G1 points.

## Storage model

| Tier | Key | Contents | TTL policy |
| --- | --- | --- | --- |
| Instance | `Config`, `RoundCounter` | Drand pubkey, DST, genesis, period, USDC SAC | Extended on every mutating call (~60 days bump) |
| Persistent | `Round(id)`, `State(id, bidder)` | Round record, escrow, revealed value, settlement flags | Extended on read/write (~60 days bump); required for clear/settle/void |
| Temporary | `Seal(id, bidder)` | Ciphertext + auditor blob | Extended on commit, `open_reveal`, and `get_seal` reads to cover `reveal_deadline + 1 day`; auto-expires afterward |

### Cleanup semantics

- **Seals (Temporary)** are intentionally ephemeral. After the reveal window plus a one-day observer buffer, `get_seal` returns `None`. This is by design — observers see the sealed → gone lifecycle.
- **Settlement data (Persistent)** is never dropped silently. `clear`, `settle`, and `void` operate only on persistent bid state and escrow; they remain available even after seals expire.
- **`open_reveal`** re-extends every committed seal through the reveal window so keeper/observer reads stay available during the revealing phase.
- Seal TTL is computed from `reveal_deadline`, not a fixed constant, so long pre-reveal commit windows do not lose ciphertext before Drand round R.

## Settlement rails

Two **SEP-41 token** paths on testnet (USDC SAC):

1. **x402** — agent → appraisal server micro-payment (HTTP 402, signed auth entry, facilitator settles on RPC). Used for **appraisal only**. Testnet-only in automated e2e.
2. **SAC `settle()`** — contract transfers winner escrow → operator; refunds losers. Used for **prize settlement**. Not x402.

Same asset rail on a given network (USDC on testnet); authorization differs. Mainnet smoke uses **native XLM SAC**, not USDC — see `docs/LIMITATIONS.md`.

## Agent authorization

- **Off-chain mandate**: principal signs caps (maxBid, maxEscrow, maxAppraisalSpend) for a session Ed25519 key
- **On-chain cap**: `valid = value > 0 && value ≤ escrow` at reveal
- **Production path**: Passkey / OpenZeppelin Smart Account with policy signers (see `docs/ECOSYSTEM.md`)

## Relayer Strategy

Critical path uses **direct Soroban RPC** (proven live). The SDK also exposes an optional OpenZeppelin Relayer Channels submitter:

```ts
import { SubRosaClient, createOzChannelsSubmitterFromEnv } from "@sub-rosa/sdk";

const sdk = new SubRosaClient({
  rpcUrl,
  networkPassphrase,
  contractId,
  secretKey,
  submitter: createOzChannelsSubmitterFromEnv(),
});
```

If the submitter is absent, the SDK signs and submits exactly as before. If present, it signs locally, sends signed XDR through Channels, then reads finality/result over Soroban RPC.

## Live proof commands

```bash
pnpm lifecycle:e2e    # full round, 2 bidders, USDC SAC
pnpm agents:e2e       # multi-agent + x402 + keeper → single UI trace
pnpm appraisal:e2e    # x402 appraisal settle
pnpm keeper:e2e       # permissionless reveal
pnpm sdk:smoke        # deploy + commit smoke
pnpm mainnet:deploy   # mainnet wasm + round
pnpm mainnet:settle   # mainnet keeper close
pnpm keeper:watch     # polling keeper daemon
```

## Mainnet artifacts

- Contract: `CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX`
- Round 1: committed, revealed, cleared, settled (native XLM SAC smoke)
