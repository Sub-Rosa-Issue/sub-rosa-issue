<p align="center">
  <img src="frontend/public/images/oversync-logo.png" alt="OverSync" width="240" />
</p>

# OverSync

**A non-custodial Ethereum ↔ Stellar bridge built on symmetric HTLCs — no validator set, no attester, no admin escape hatch.**

OverSync moves native assets between Ethereum and Stellar atomically.
Funds are locked in hash-time-lock contracts on both chains; settlement
is a `sha256` preimage reveal, not a multisig attestation. If anything
in the bridge fails — coordinator down, resolver malicious, RPC
rate-limited, frontend offline — the locked funds either settle to
the beneficiary or refund permissionlessly to the user. There is no
state in which user funds are stranded under operator control.

> **Status (May 2026).** v2 is the live design and is **deployed on
> testnet** (Sepolia + Stellar testnet). The public frontend is
> **testnet-only** — the network selector shows **Mainnet Coming** and
> does not expose the legacy v1 mainnet path until v2 completes its
> independent audit (Q1 2027). Set `VITE_MAINNET_ENABLED=true` only
> when re-enabling mainnet after audit. See [`ROADMAP.md`](ROADMAP.md)
> for the audit-first launch plan and [`docs/REVIEW_RESPONSE.md`](docs/REVIEW_RESPONSE.md)
> for the full response to v1 reviewer feedback.

> **Legacy v1 mainnet (code only).** The v1 single-relayer stack and
> Stellar claimable-balance path remain in the repository for reference
> ([`stellar/src/claimable-balance.ts`](stellar/src/claimable-balance.ts))
> but are **not offered in the public UI** while `VITE_MAINNET_ENABLED`
> is unset or `false`. Reviewers and users should evaluate the v2
> Soroban HTLC testnet deployment listed below; v2 mainnet is
> intentionally gated on fuzz/differential tests, multisig governance,
> and external audit.

---

## Why OverSync exists

Historically, cross-chain bridges have caused some of the largest losses
in DeFi (Ronin $625M, Wormhole $325M, Multichain $231M). The common
failure pattern is the same: an off-chain validator quorum that signs
proofs of locks gets compromised, and the wrapped tokens on the
destination chain get minted without a real lock.

OverSync gives up the convenience of validator-set bridging in
exchange for a strictly weaker trust assumption:

| Compromise that lets attacker steal locked funds | Validator-set bridge (Axelar, Allbridge, Wormhole-style) | OverSync v2 |
|---|---|---|
| Compromise an off-chain signer quorum | **Yes** | **No** — no privileged signer exists in the HTLC |
| Compromise a first-party attester (Circle CCTP, etc.) | **Yes** (for attester bridges) | **No** — no attester is consulted |
| Break sha256 / keccak256 | No | Yes — but this breaks all of crypto |
| Compromise Ethereum or Stellar consensus | Yes (both) | Yes (both) |

The full competitive analysis (CCTP v2, Axelar ITS, Allbridge) lives
in [`docs/DIFFERENTIATION.md`](docs/DIFFERENTIATION.md).

---

## Live operational status

This is what is actually running, **today**, against the testnet
deployment. Each row is a verifiable claim — every link points at the
source code or block explorer.

### Smart contracts (testnet)

| Contract | Chain | Address | Source |
|---|---|---|---|
| `HTLCEscrow` | Sepolia | [`0xb352339BEb…988bB178`](https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178) | [`contracts/v2/HTLCEscrow.sol`](contracts/contracts/v2/HTLCEscrow.sol) |
| `ResolverRegistry` | Sepolia | [`0x7D9ce70Aa4…1B6D1D99`](https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99) | [`contracts/v2/ResolverRegistry.sol`](contracts/contracts/v2/ResolverRegistry.sol) |
| `oversync-htlc` | Stellar testnet | [`CDIKSJKVMX…WK2CTA6JK`](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK) | [`soroban/contracts/htlc/src/lib.rs`](soroban/contracts/htlc/src/lib.rs) |
| `oversync-resolver-registry` | Stellar testnet | [`CBSR7Z4MHL…TIZ4WGF`](https://stellar.expert/explorer/testnet/contract/CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF) | [`soroban/contracts/resolver-registry/src/lib.rs`](soroban/contracts/resolver-registry/src/lib.rs) |

### Off-chain services

| Service | Status | Code | Notes |
|---|---|---|---|
| Reference coordinator | Hosted on Render | [`coordinator/`](coordinator/) | SQLite-backed order book, REST + WebSocket, never holds keys that can move user funds |
| Reference resolver | Open-source runner + Docker image | [`resolver/`](resolver/) | Anyone who staked in the registry can run it |
| Bridge frontend | Deployed on Vercel | [`frontend/`](frontend/) | **Testnet-only** public UI (`VITE_MAINNET_ENABLED=false`); **Mainnet Coming** badge; v2 flow on Sepolia + Stellar testnet |
| **Refund watchdog** | Always-on background scanner | [`relayer/src/refund-watchdog.ts`](relayer/src/refund-watchdog.ts) | Scans the order map every 60s; refunds any XLM→ETH swap pending > 5 min |
| **Event listeners** | Block-by-block polling | [`relayer/src/contract-event-poller.ts`](relayer/src/contract-event-poller.ts) | Stateless `queryFilter` polling, immune to load-balanced public RPC `filter not found` failures |

### Test coverage (CI-enforced)

| Layer | Test count | Framework | Pinned in CI |
|---|---|---|---|
| Soroban HTLC | 10 | Rust `#[contracttest]` | [`.github/workflows/`](.github/workflows/) |
| Soroban ResolverRegistry | 6 | Rust `#[contracttest]` | yes |
| EVM HTLCEscrow | 15 | Hardhat + Chai | yes |
| EVM ResolverRegistry | 6 | Hardhat + Chai | yes |
| SDK | 8 | Vitest | yes |
| Coordinator | 4 | Vitest | yes |

---

## How a swap actually works (60-second tour)

```
              ┌────────────────────┐                ┌────────────────────┐
              │ Ethereum HTLCEscrow│                │ Soroban oversync-  │
              │                    │                │ htlc               │
              │  ┌──────────────┐  │                │  ┌──────────────┐  │
   1. lock ─► │  │ locked ETH   │  │                │  │ locked XLM   │  │ ◄─ 2. lock
              │  │ hashlock,    │  │                │  │ hashlock,    │  │
              │  │ timelock=24h │  │                │  │ timelock=12h │  │
              │  └──────────────┘  │                │  └──────────────┘  │
              └────────┬───────────┘                └──────────┬─────────┘
                       │                                       │
                       │ 4. resolver claims ETH                │ 3. user claims XLM
                       │    with preimage                      │    revealing preimage
                       ▼                                       ▼
                  ┌─────────┐                              ┌─────────┐
                  │Resolver │                              │  User   │
                  └─────────┘                              └─────────┘
```

1. **User locks ETH** on Ethereum under `sha256(secret)` and `timelock = 24h`.
2. **Resolver locks XLM** on Stellar under the same hashlock, but with a shorter `timelock = 12h`. The resolver verifies the source-side lock is finalised before locking destination.
3. **User claims XLM** on Stellar by revealing the secret. The preimage is now public on-chain.
4. **Resolver claims ETH** on Ethereum using that same secret.

If the user never claims, the resolver's destination-side refund
expires first (12h vs 24h), so the resolver gets their XLM back. The
user can then refund their ETH at 24h. Both legs settle, or both
legs refund — there is no state in between.

The full sequence (with reorg handling, RPC-failure recovery, and the
refund mechanism stack) is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Refund layers — why funds cannot be lost

OverSync ships **four** independent refund mechanisms. Each one is a
backstop for the previous one. Even with three of the four offline, a
user always has a way to recover their funds.

| Layer | What it does | Where it lives | Latency |
|---|---|---|---|
| **On-chain HTLC refund** | After `timelock`, **anyone** can call `refundOrder` and the funds return to the user's `refundAddress`. Permissionless. | [`HTLCEscrow.refundOrder`](contracts/contracts/v2/HTLCEscrow.sol), [`oversync-htlc::refund_order`](soroban/contracts/htlc/src/lib.rs) | ≤ 24h (one timelock cycle) |
| **Frontend refund dialog** | Pending ETH→XLM orders show a "Refund ETH" button in transaction history once the timelock expires. One-click recovery. | [`frontend/src/features/refund/RefundDialog.tsx`](frontend/src/features/refund/RefundDialog.tsx) | User-driven |
| **Automatic XLM refund** | If a XLM→ETH swap's ETH leg fails (RPC timeout, insufficient funds), the relayer refunds the user's XLM in the same HTTP response. | [`relayer/src/xlm-refund.ts`](relayer/src/xlm-refund.ts) | < 30s |
| **Background watchdog** | Scans the order book every 60s. Any XLM→ETH swap pending > 5 minutes triggers an automatic XLM refund, even if the user closed the tab. | [`relayer/src/refund-watchdog.ts`](relayer/src/refund-watchdog.ts) | < 6 min |

The architectural rationale and exact code paths are in
[`ARCHITECTURE.md` § 6](ARCHITECTURE.md#6-refund-mechanisms).

---

## v1 vs v2 at a glance

| Concern | v1 (legacy — UI disabled) | v2 (live testnet, mainnet Q1 2027) |
|---|---|---|
| Stellar settlement | Claimable balance with unconditional claimants — coordinator-custodial | [Soroban HTLC contract](soroban/contracts/htlc/src/lib.rs) — sha256 hashlock + timelock, non-custodial |
| Ethereum settlement | Three overlapping contracts (`HTLCBridge`, `MainnetHTLC`, `EscrowFactory`); resolver allowlist not enforced | One canonical [`HTLCEscrow`](contracts/contracts/v2/HTLCEscrow.sol) + [`ResolverRegistry`](contracts/contracts/v2/ResolverRegistry.sol) |
| Operator model | Single relayer with hot keys for both chains | Open [`ResolverRegistry`](docs/RESOLVERS.md) with stake + slash; community resolvers welcome |
| Refunds | Mocked in code; refund address was the relayer's | Four-layer refund stack (table above); funds always return to user |
| Order persistence | In-memory `Map`, lost on restart | SQLite-backed coordinator with XState-style state machine |
| Frontend history | Hard-coded mock entries + fake hash fallback | Real coordinator API + on-chain events only (filtered via [`isRealHash`](frontend/src/components/TransactionHistory.tsx)) |
| Event listeners | `contract.on(...)` — breaks on load-balanced public RPCs | Stateless block polling — [`contract-event-poller.ts`](relayer/src/contract-event-poller.ts) |
| Tests | Ad-hoc | 49 unit tests across Solidity + Rust + TS, all gated in GitHub Actions |
| Console output in prod | Sensitive state logged to browser devtools | All `console.*` stripped via Vite `esbuild.drop` + source maps disabled |

---

## Repository layout

```
OverSync-1nchFusion/
├── soroban/                      # Rust workspace — Soroban contracts
│   ├── contracts/htlc/           # oversync-htlc (HTLC for Stellar)
│   └── contracts/resolver-registry/
├── contracts/                    # Solidity (Hardhat)
│   ├── contracts/v2/             # Canonical HTLCEscrow + ResolverRegistry (v2)
│   └── contracts/                # Legacy v1 (retained in repo; UI gated off)
├── packages/sdk/                 # @oversync/sdk — shared TS layer
├── coordinator/                  # v2 coordinator (SQLite + REST/WS)
├── resolver/                     # Open-source resolver runner + Docker
├── relayer/                      # v1 relayer (+ refund watchdog, polling listeners)
├── frontend/                     # React + Vite dApp (public: testnet-only; mainnet via env flag)
├── docs/                         # Trust model, security, deploy, resolvers, differentiation
└── .github/workflows/            # CI for TS + Rust + Solidity
```

---

## Quick start

Requires Node 22.5+ (built-in `node:sqlite`), pnpm 9+, Rust + `stellar-cli`, and Foundry/Hardhat.

```bash
git clone https://github.com/karagozemin/OverSync-1nchFusion
cd OverSync-1nchFusion
pnpm install
cp env.example .env

# Build SDK
pnpm --filter @oversync/sdk build

# Compile + test Solidity v2 contracts
pnpm --filter @oversync/contracts compile
pnpm --filter @oversync/contracts exec hardhat test test/v2

# Build + test Soroban contracts
cd soroban && cargo test --release && cd ..

# Run the cross-chain differential test harness (EVM ↔ Soroban hashlock
# parity, using the shared @oversync/sdk secret helpers). No live RPC
# required — the harness drives in-memory simulators of each chain.
pnpm test:e2e

# Run coordinator
pnpm --filter @oversync/coordinator dev

# Run frontend
pnpm --filter @oversync/frontend dev
```

To deploy your own resolver against the testnet registry, follow
[`docs/RESOLVERS.md`](docs/RESOLVERS.md).

---

## Trust model in one paragraph

User funds are locked in HTLC contracts on both chains. Each lock has
a `hashlock` and a `timelock`. The locked funds can only be moved by:

1. Anyone (typically the beneficiary) revealing a preimage whose
   digest matches `hashlock`, before `timelock`.
2. Anyone (typically the user) calling `refund` after `timelock`. The
   funds return to the original `refundAddress` — which is **always
   the user** in OverSync v2.

The coordinator never signs a transaction that could move user funds
without one of these conditions being satisfied. Resolvers stake into
the on-chain `ResolverRegistry`; misbehaviour is slashable. See
[`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) for the full STRIDE-style
threat model.

---

## Documentation

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full technical architecture: invariants, sequence diagrams, refund stack, failure catalogue, cryptographic primitives, operational characteristics, auditor checklist |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Developer setup, CI test matrix, and pull request expectations |
| [`ROADMAP.md`](ROADMAP.md) | Milestone-by-milestone delivery plan with verifiable artefacts; testnet v2 live, mainnet UI gated until audit |
| [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) | Non-custodial proofs and per-actor threat analysis |
| [`docs/DIFFERENTIATION.md`](docs/DIFFERENTIATION.md) | Comparison with CCTP v2, Axelar ITS, Allbridge; where OverSync is the right vs wrong tool |
| [`docs/TRACTION.md`](docs/TRACTION.md) | Go-to-market, KPIs we publish, partnership pipeline |
| [`docs/RESOLVERS.md`](docs/RESOLVERS.md) | How to run your own resolver |
| [`docs/SECURITY.md`](docs/SECURITY.md) | STRIDE threat model, audit prep checklist, bug bounty |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Testnet + mainnet deployment, env var reference, network configuration |
| [`docs/REVIEW_RESPONSE.md`](docs/REVIEW_RESPONSE.md) | Direct response to v1 reviewer feedback, item by item |
| [`docs/POST_DEMO_EVIDENCE_PACK.md`](docs/POST_DEMO_EVIDENCE_PACK.md) | Post-demo evidence pack template for reviewer and investor follow-up |

---

## License

MIT. See [`LICENSE`](LICENSE).
