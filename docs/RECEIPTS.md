# Round Receipts

A **round receipt** is a portable JSON document that captures the final state of a Sub Rosa auction round. Receipts can be exported from any live contract and verified offline — no RPC, no secrets, no Stellar dependency.

## Schema

| Field | Type | Description |
| --- | --- | --- |
| `version` | `number` | Receipt schema version (currently `1`) |
| `network` | `string` | Stellar network passphrase (e.g. `"Test SDF Network ; September 2015"`) |
| `networkFingerprint` | `string` (64 hex chars) | `sha256(utf8(network))` — lets the offline verifier detect a tampered `network` field without any caller context |
| `contractId` | `string` | Contract address (starts with `C`) |
| `exportedAt` | `string (ISO 8601)` | When the receipt was exported |
| `roundId` | `string` (decimal bigint) | Round number |
| `itemRef` | `string` (hex) | Item identifier (e.g. the commitment of the highest valid bid) |
| `revealRound` | `number` | Drand quicknet round used for timelock |
| `clearingRule` | `"HighestBid"` or `"LowestBid"` | Selection rule |
| `commitDeadline` | `string` (decimal) | Ledger sequence deadline for commit |
| `revealDeadline` | `string` (decimal) | Ledger sequence deadline for reveal |
| `operator` | `string` (G… address) | Round creator / prize sender |
| `auditorPubkey` | `string` (hex) | X25519 auditor public key |
| `bidders` | `string[]` | Ordered list of participant Stellar addresses |
| `bids` | `Record<string, BidReceiptEntry>` | Per-bidder entry, keyed by address |
| `winner` | `string` (G… address) or `null` | Declared winner (may be null if voided or no valid bids) |
| `winningValue` | `string` (decimal) or `null` | Declared winning bid value |
| `status` | `"Open"` / `"Revealing"` / `"Cleared"` / `"Settled"` / `"Voided"` | Round status |

### `BidReceiptEntry`

| Field | Type | Description |
| --- | --- | --- |
| `commitment` | `string` (64 hex chars) | `sha256(be16(value) || nonce)` |
| `escrow` | `string` (decimal) | Escrow amount |
| `revealedValue` | `string` (decimal) or `null` | Bid value (null if not-revealed) |
| `nonce` | `string` (64 hex chars) or `null` | The per-bid 32-byte nonce. Persisted on-chain at reveal time; present in live exports for revealed bids. `null` only for unrevealed bids. |
| `hashValid` | `boolean` or `null` | Whether `revealedValue` and `nonce` match `commitment`. `null` when `nonce` is not available (unrevealed); `true`/`false` when both are present. |
| `valid` | `boolean` | Whether the bid passed all on-chain validity checks (value ≤ escrow etc.) |
| `settled` | `boolean` | Whether escrow was settled (transferred or refunded) |
| `evidence` | `object` or `null` | Contains `ciphertext` (hex, may be null after expiry) and `auditorBlob` (hex, may be null after expiry) |

Expired Temporary storage (`ciphertext`, `auditorBlob`) is marked honestly as `null`.

### Serialization format

Receipts use **canonical JSON** — keys are deep-sorted lexicographically. BigInt values are serialized as decimal strings (not numbers) to preserve precision. Byte strings (commitments, nonces, evidence) are lowercase hex.

## Offline verification

The `verifyReceipt` function in `@sub-rosa/sdk` performs **stateless, offline** checks:

| Check | What it detects | Error code |
| --- | --- | --- |
| Schema version | Unsupported receipt format | `unsupported_version` |
| Network fingerprint | `networkFingerprint` does not match `sha256(utf8(network))` — detects a tampered passphrase without caller context | `network_mismatch` |
| Network metadata | Missing or malformed fields | `missing_network`, `invalid_contract_id`, etc. |
| Clearing rule | Invalid or missing rule | `invalid_clearing_rule` |
| Bidder list consistency | Duplicates, missing bid entries, orphan entries | `duplicate_bidder`, `missing_bid_entry`, `orphan_bid_entry` |
| Commitment binding | For each revealed bid **where `nonce` is present**, recomputes `sha256(be16(value) || nonce)` and compares to stored commitment. Skipped when `nonce` is null (on-chain export; contract already verified on-chain). | `commitment_mismatch` |
| Winner selection | Recomputes the winner from valid revealed bids and compares to declared winner | `winner_mismatch` |
| Evidence hex format | Ciphertext/auditorBlob not valid hex | `invalid_evidence_hex` (warning) |

### What the verifier cannot check

- **On-chain state** — the verifier does not connect to Stellar. It cannot confirm that the receipt matches what is currently stored on-chain at `contractId`. That is a trust choice: the exporter is responsible for honesty.
- **Drand signature correctness** — the contract verifies the BLS signature. The offline verifier trusts the receipt's `revealRound` metadata.
- **Escrow amounts** — the verifier checks internal consistency but does not independently verify balances.
- **Timing** — deadlines are recorded as metadata but not cross-checked against ledger state.

### Trust model

A valid receipt proves **internal consistency**: all revealed values bind to their commitments via `sha256`, and the declared winner is the correct one given the clearing rule. This is useful for:

- **Audit trails** — prove a round was correctly computed after the fact
- **Dispute resolution** — a participant who saved the receipt can verify the operator ran the round fairly
- **Archival** — compact snapshot of a round's outcome without indexing the full chain

The receipt's trust depends on the **exporter** being honest about the on-chain data. Anyone can re-export and compare. For full trust, export immediately after settle and compare receipts from multiple parties.

## Usage

### Export from a live contract

```bash
# Requires: RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID in environment
pnpm --filter @sub-rosa/receipt-cli receipt export 1
```

### Verify offline

```bash
pnpm --filter @sub-rosa/receipt-cli receipt verify round-1-receipt.json
```

### Programmatic (TypeScript)

```ts
import { verifyReceipt, parseReceipt } from "@sub-rosa/sdk";
import { readFileSync } from "node:fs";

const receipt = parseReceipt(readFileSync("round-1-receipt.json", "utf-8"));
const result = verifyReceipt(receipt);
console.log(result.valid ? "✓ Receipt valid" : "✗ Receipt invalid");
console.table(result.issues);
```

## Fixtures

Test fixtures live in `services/receipt-cli/src/fixtures/`:

| Fixture | Expectation |
| --- | --- |
| `golden.json` | 3 bidders, HighestBid, bidder 2 wins with 250 — passes all checks |
| `testnet-proof.json` | 2 bidders, round 42 — passes all checks (represents a real testnet export) |
| `tampered-winner.json` | Declared winner differs from computed winner — `winner_mismatch` |
| `tampered-values.json` | Revealed values swapped so commitments don't bind — `commitment_mismatch` |
| `tampered-commitment.json` | One commitment hash replaced with garbage — `commitment_mismatch` |
| `tampered-network.json` | Passphrase changed to mainnet but `networkFingerprint` kept as testnet — always fails with `network_mismatch` |
| `tampered-order.json` | Tied bids, bidders reordered so winner changes — `winner_mismatch` |
| `tampered-evidence.json` | Invalid hex in evidence ciphertext — `invalid_evidence_hex` |

Run fixture tests:

```bash
pnpm --filter @sub-rosa/receipt-cli test
```
