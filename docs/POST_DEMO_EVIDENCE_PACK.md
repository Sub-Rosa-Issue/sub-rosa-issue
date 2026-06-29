# OverSync — Post-Demo Evidence Pack

Fill this template within 15 minutes of a live demo. Every section has a
source link or a placeholder; do not leave prose claims unbacked. Replace
`{placeholders}` with real values.

---

## Demo metadata

| Field | Value |
|---|---|
| **Date** | `{YYYY-MM-DD}` |
| **Environment** | `{testnet / mainnet}` |
| **Reviewer / audience** | `{SCF round X · investor name · ecosystem partner}` |
| **Demo lead** | `{name}` |
| **Duration** | `{start} – {end} ({TZ})` |

---

## Live URLs

| Service | URL | Status during demo |
|---|---|---|
| Bridge frontend | `{Vercel deployment URL}` | `{operational / degraded / down}` |
| Coordinator health | `{coordinator URL}/health` | `{HTTP 200 / error}` |
| Coordinator API | `{coordinator URL}` | |
| Prometheus metrics | `{coordinator URL}/metrics` | `{scrapable / not exposed}` |

Health endpoint returns `{"status":"ok","uptime_seconds":N,"db_size_bytes":N}`.

---

## Smart contract addresses demonstrated

| Contract | Chain | Address | Block explorer |
|---|---|---|---|
| `HTLCEscrow` | Sepolia | `0xb352339BEb146f2699d28D736700B953988bB178` | [Etherscan](https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178) |
| `ResolverRegistry` | Sepolia | `0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99` | [Etherscan](https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99) |
| `oversync-htlc` | Stellar testnet | `CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK) |
| `oversync-resolver-registry` | Stellar testnet | `CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF) |

Source of truth: [`deployments.testnet.json`](../deployments.testnet.json)

---

## Order lifecycle evidence

### ETH → XLM swap

| Step | Transaction / event | Link |
|---|---|---|
| 1. User locks ETH on Sepolia `HTLCEscrow` | `{Sepolia tx hash}` | [Etherscan](https://sepolia.etherscan.io/tx/{hash}) |
| 2. Resolver locks XLM on Stellar `oversync-htlc` | `{Stellar tx hash}` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/{hash}) |
| 3. User claims XLM on Stellar (preimage revealed) | `{Stellar tx hash}` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/{hash}) |
| 4. Resolver claims ETH on Sepolia | `{Sepolia tx hash}` | [Etherscan](https://sepolia.etherscan.io/tx/{hash}) |
| Coordinator order ID | `{UUID}` | `{coordinator URL}/api/orders/{UUID}` |

### XLM → ETH swap

| Step | Transaction / event | Link |
|---|---|---|
| 1. User locks XLM on Stellar `oversync-htlc` | `{Stellar tx hash}` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/{hash}) |
| 2. Resolver locks ETH on Sepolia `HTLCEscrow` | `{Sepolia tx hash}` | [Etherscan](https://sepolia.etherscan.io/tx/{hash}) |
| 3. User claims ETH on Sepolia (preimage revealed) | `{Sepolia tx hash}` | [Etherscan](https://sepolia.etherscan.io/tx/{hash}) |
| 4. Resolver claims XLM on Stellar | `{Stellar tx hash}` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/{hash}) |
| Coordinator order ID | `{UUID}` | `{coordinator URL}/api/orders/{UUID}` |

### Screenshots / screen recording

| Asset | Link |
|---|---|
| Frontend swap flow (screenshot) | `{link to PNG or frame}` |
| Coordinator history API response (screenshot or JSON) | `{link}` |
| Wallet interaction (e.g. MetaMask / Freighter confirmation) | `{link}` |

---

## CI run & test coverage

| CI workflow | Run URL | Status |
|---|---|---|
| CI (TypeScript + Solidity + Soroban) | `{https://github.com/karagozemin/OverSync/actions/runs/{id}}` | `{passing / failing}` |
| Contracts (Foundry fuzz + Slither) | `{https://github.com/karagozemin/OverSync/actions/runs/{id}}` | `{passing / failing}` |

### Test counts (CI-enforced)

| Layer | Tests | Passing |
|---|---|---|
| Soroban HTLC | 10 | `{yes / no}` |
| Soroban ResolverRegistry | 6 | `{yes / no}` |
| EVM HTLCEscrow | 15 | `{yes / no}` |
| EVM ResolverRegistry | 6 | `{yes / no}` |
| SDK | 8 | `{yes / no}` |
| Coordinator | 4 | `{yes / no}` |
| **Total** | **49** | |

Verification commands (run against the tagged demo commit `{git SHA}`):

```bash
pnpm install
pnpm --filter @oversync/sdk test
pnpm --filter @oversync/coordinator test
pnpm --filter @oversync/contracts exec hardhat test test/v2
cd soroban && cargo test --release && cd ..
```

---

## Refund path evidence

### Mechanism 1 — On-chain HTLC refund (permissionless)

| Chain | Refund tx | Link |
|---|---|---|
| Sepolia `HTLCEscrow.refundOrder` | `{Sepolia tx hash}` | [Etherscan](https://sepolia.etherscan.io/tx/{hash}) |
| Stellar `oversync-htlc::refund_order` | `{Stellar tx hash}` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/{hash}) |

Verified by tests:
- `returns the locked amount to the refund address after timeout, permissionlessly`
- `rejects refund after a successful claim`
- `refund_after_timeout_pays_refund_address`
- `refund_after_claim_fails`

Source: [`HTLCEscrow.refundOrder`](../contracts/contracts/v2/HTLCEscrow.sol),
[`oversync-htlc::refund_order`](../soroban/contracts/htlc/src/lib.rs)

### Mechanism 2 — Frontend refund dialog

| Evidence | Link |
|---|---|
| Screenshot of "Refund ETH" button in transaction history | `{link}` |
| Source | [`frontend/src/features/refund/RefundDialog.tsx`](../frontend/src/features/refund/RefundDialog.tsx) |

### Mechanism 3 — Automatic XLM refund (inline)

| Evidence | Link |
|---|---|
| Coordinator log line showing inline refund on lock failure | `{log snippet or link}` |
| Source | [`relayer/src/xlm-refund.ts`](../relayer/src/xlm-refund.ts) |

### Mechanism 4 — Background watchdog

| Evidence | Link |
|---|---|
| Watchdog log line showing refund for order pending >5 min | `{log snippet or link}` |
| Source | [`relayer/src/refund-watchdog.ts`](../relayer/src/refund-watchdog.ts) |

---

## What changed since last review

{If this is a follow-up demo, summarise changes since the previous review.
Reference specific commits, PRs, or milestone deliverables.}

| Area | Previous state | Current state | Ref |
|---|---|---|---|
| `{area}` | `{before}` | `{after}` | `{commit / PR link}` |

{If this is the first review, note:}

> First evidence pack for this audience. Baseline snapshot of all
> contracts, services, and CI at commit `{SHA}`.

---

## Known limitations

These are honest caveats — anything a reviewer or investor would discover
by poking deeper:

| Limitation | Impact | Tracked in |
|---|---|---|
| Coordinator uses SQLite (single-node, no horizontal read scaling) | Throughput bound to single-node disk; no HA failover | [`coordinator/`](../coordinator/) — Postgres migration planned Q3 2026 ([`ROADMAP.md`](../ROADMAP.md)) |
| Soroban resolver-registry binding not enforced in HTLC contract | A resolver that is not in the registry can still fill orders as long as it knows the coordinator endpoint | [`ROADMAP.md`](../ROADMAP.md) Q3 2026 milestone |
| No formal fuzz/invariant test suite on EVM side yet | Foundry tests not in CI gate; [`contracts/test/foundry/`](../contracts/test/foundry/) in progress | [`ROADMAP.md`](../ROADMAP.md) Q3 2026 milestone |
| Public frontend is testnet-only | Mainnet UI gated behind `VITE_MAINNET_ENABLED` flag until v2 audit completes | [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — mainnet checklist |
| No partial fills on Soroban side | Parity with EVM planned for v2.1 | [`ROADMAP.md`](../ROADMAP.md) Q2–Q3 2027 |
| Solo-team bus factor | Open resolver protocol decentralises operations; CI + docs lower onboarding bar | [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md) item 8 |

---

## Next milestone ask

| Milestone | Target date | Deliverable | Funding ask |
|---|---|---|---|
| `{milestone name}` | `{YYYY-MM-QQ}` | `{concrete deliverable}` | `{$amount}` |

Detailed budget breakdown: [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md) § 9.

---

## Reviewer / investor follow-up checklist

- [ ] Frontend URL loaded and presented correctly (network selector shows testnet, non‑interactive mainnet badge).
- [ ] Coordinator health endpoint returns `200` with `status: "ok"`.
- [ ] Etherscan links resolve and show the deployed contract with verified source.
- [ ] Stellar Expert links resolve and show the deployed contract.
- [ ] ETH→XLM swap traced end-to-end on both explorers.
- [ ] XLM→ETH swap traced end-to-end on both explorers.
- [ ] At least one refund transaction confirmed on-chain.
- [ ] CI run for the demo commit is green (all 49 tests passing).
- [ ] Coordinator history API returns only real transactions — no `0x1234…` placeholder hashes.
- [ ] All links in this document resolve correctly.
- [ ] Known limitations section read and acknowledged.
- [ ] Next milestone ask and budget understood.
