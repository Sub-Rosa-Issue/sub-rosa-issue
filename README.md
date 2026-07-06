> [!NOTE]
> This repository is the Drips Network contribution workspace for Sub Rosa,
> created specifically for participation in the Stellar Wave program. The main
> Sub Rosa repository is maintained separately.

<p align="center">
  <img src="./assets/sub-rosa-readme.png" width="250" alt="Sub Rosa logo" />
</p>

# Sub Rosa

**1st Place — Hack Privacy Track, Build On Stellar Hackathon — IBW 2026**

**Verifiable allocation infrastructure for Stellar grants, hackathons,
bounties, RFPs, and sealed auctions.** Participants submit sealed scores, bids,
or allocation decisions now; a public, unbiased Drand round unseals them later,
verifiably and all at once. The protocol — not the operator — owns fairness.

> Built on what's proven. Sealed by math, not by trust.

Sub Rosa is now evolving from a hackathon-winning privacy demo into reusable
allocation infrastructure for Stellar apps: a Soroban primitive, TypeScript
SDK, keeper service, and integration templates for teams that need sealed
judging, scoring, bidding, or allocation without building cryptography from
scratch.

Target next milestone: **Stellar Community Fund Build Award**. The goal is to
turn the current proof into production-ready developer infrastructure:
`@sub-rosa/sdk`, optional React hooks/components, hosted keeper/reveal
operations, hardened contracts, and mainnet launch.

Licensed under [MIT](./LICENSE).

---

## Proof at a glance

| Layer | Command | Network | What it proves |
| --- | --- | --- | --- |
| **Full product** | `pnpm lifecycle:e2e` | Testnet | 2 bidders, USDC SAC, keeper settle → contract **0** |
| **Multi-agent** | `pnpm agents:e2e` | Testnet | Mandate + x402 + keeper reveal + settle → **single UI trace** |
| **x402 appraisal** | `pnpm appraisal:e2e` | Testnet | HTTP 402 → on-chain USDC settle |
| **Mainnet smoke** | `pnpm mainnet:deploy` + `pnpm mainnet:settle` | Mainnet | Deploy, BLS, settle on **real XLM** |
| **Mainnet verify** | `pnpm mainnet:verify` | Mainnet | Read-only check of settled round 1 |

See [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) for honest scope (mainnet ≠ full USDC product).

---

## Pilot plan

Sub Rosa's first pilot will run with **OverBlock** as an internal
builder/community environment for sealed judging, bounty allocation, and
grant-style scoring workflows.

Beyond OverBlock, we are actively preparing external pilot conversations with
Stellar ecosystem teams, hackathon organizers, DAOs, and grant/RFP programs
that need sealed scoring, sealed bidding, or verifiable allocation workflows.

See [docs/PILOT_PLAYBOOK.md](./docs/PILOT_PLAYBOOK.md) for the pilot scope,
SCF-style demo narrative, and outreach message.

---

## Integration model

Sub Rosa is not only a hosted frontend. Other Stellar applications can embed
the primitive directly:

```bash
npm install @sub-rosa/sdk
```

```ts
import { SubRosaClient } from "@sub-rosa/sdk";
import { sealBid, quicknet } from "@sub-rosa/tlock";

const client = new SubRosaClient({
  rpcUrl,
  networkPassphrase,
  contractId,
  secretKey,
});

const sealed = await sealBid({
  value,
  nonce,
  round: revealRound,
  client: quicknet(),
  identity,
  auditorPublicKey,
});

await client.commit({ roundId, sealed, escrow });
```

The app layer can be a DAO tool, grants platform, auction UI, RFP workflow, or
allocation dashboard. Sub Rosa supplies the sealed round state machine.

---

## Deployed artifacts

### Mainnet (settlement smoke)

| Field | Value |
| --- | --- |
| Contract | [`CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX`](https://stellar.expert/explorer/public/contract/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX) |
| WASM hash | `353915ad440965ea5f8d92fdb8d93cb2e309fb365e68e6762bca7fd6762b30c7` |
| Round | 1 · **Settled** |
| Drand R | 29,174,905 |
| Token | Native XLM SAC |
| Bid / escrow | **1 XLM / 5 XLM** (not testnet 700 USDC demo) |

```bash
pnpm mainnet:ready -- --strict   # consolidated read-only readiness
pnpm mainnet:verify          # read-only — no secrets
pnpm mainnet:micro           # dry-run checklist; --execute needs MAINNET_CONFIRM
```

### Testnet (full product + UI trace)

| Field | Value |
| --- | --- |
| Contract (UI / agents:e2e) | [`CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y`](https://stellar.expert/explorer/testnet/contract/CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y) |
| Drand R | 29,176,840 |
| Canonical trace | `apps/web/src/demo/demo-trace.generated.ts` (from `pnpm agents:e2e`) |

---

## The idea

Public ledgers are transparent by default, which quietly breaks fair allocation
when participants or judges can see each other's inputs too early. That affects
grant scoring, hackathon judging, bounty allocation, RFPs, and sealed auctions.
The usual "fix" trusts the operator. Sub Rosa removes the operator from the
trust path entirely:

- **Seal** each bid with Drand timelock encryption (`tlock`) to a future round R.
- **Force-open** at R: BLS12-381 verified **on-chain** — simultaneous reveal.
- **Settle** deterministically. Identities disclosed only to the auditor.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the system map, lifecycle, trust boundaries, and monorepo layout.

## Monorepo layout

```
contracts/round/        Soroban primitive (Rust)
packages/tlock/         tlock seal + auditor blob
packages/sdk/           SubRosaClient + optional OZ Channels submitter
services/keeper/        Permissionless keeper + watch mode
services/appraisal-api/ x402-gated appraisal
services/agent/         Multi-agent bidders (mandate + caps)
apps/web/               Jury demo UI
docs/                   Design, threat model, track answers, deploy, limitations
```

## Quick start

```bash
pnpm install
pnpm contract:test          # 14 Rust tests
pnpm bindings:generate      # generate TS bindings from the contract
pnpm bindings:check         # verify committed bindings match the contract
pnpm web:dev                # jury UI — works without .env
pnpm agents:e2e             # testnet full agent proof (needs stellar keys)
pnpm mainnet:verify         # mainnet read-only proof
```

## Documentation

| Doc | Purpose |
| --- | --- |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | System overview, lifecycle, trust boundaries, repo map |
| [docs/SCF_PLAN.md](./docs/SCF_PLAN.md) | SCF Build framing, tranches, deliverables, ecosystem value |
| [docs/PILOT_PLAYBOOK.md](./docs/PILOT_PLAYBOOK.md) | OverBlock pilot scope, external pilot outreach, SCF-style demo narrative |
| [docs/INTEGRATION.md](./docs/INTEGRATION.md) | How another Stellar app embeds Sub Rosa |
| [docs/TECH_DESIGN.md](./docs/TECH_DESIGN.md) | Cryptography, storage, settlement rails |
| [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) | Adversaries, mitigations, honest limits |
| [docs/TRACK_ANSWERS.md](./docs/TRACK_ANSWERS.md) | Hack Privacy proof notes; agent proof as support |
| [docs/ECOSYSTEM.md](./docs/ECOSYSTEM.md) | Passkey-Kit, Smart Account Kit, OZ Relayer |
| [docs/DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md) | 5-minute jury walkthrough |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Env: UI build vs runtime secrets |
| [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) | Known scope boundaries |

## Status (submission)

- [x] Round contract + 14 tests + on-chain Drand BLS
- [x] tlock + auditor blob (13 tests)
- [x] SDK (7 tests) + optional OZ Relayer Channels submitter
- [x] Testnet **full lifecycle** (`lifecycle:e2e`) — USDC, 2 bidders, settle → 0
- [x] Testnet **multi-agent** (`agents:e2e`) — x402, mandate, keeper reveal, settle → 0, **single UI trace**
- [x] Mainnet **deploy + settle smoke** — 1/5 XLM, round 1 settled
- [x] Mainnet **verify** + **micro runner** (dry-run default, tiny XLM cap)
- [x] Jury UI — one canonical testnet trace (status, bidders, R, auditor blobs, session keys)
- [x] Watch-mode keeper (`pnpm keeper:watch`)

## SCF roadmap

| Tranche | Goal | Deliverables |
| --- | --- | --- |
| 1 | Developer infrastructure | Publish-ready `@sub-rosa/sdk`, integration docs, contract hardening, test vectors |
| 2 | Testnet pilots | Hosted keeper, reusable UI hooks/components, partner pilot templates, testnet dashboards |
| 3 | Mainnet launch | Audited/open-source contracts, mainnet deployment, production keeper ops, launch docs |

## Cryptographic design (Privacy track)

- **Seal:** Drand tlock IBE, `bls-unchained-g1-rfc9380`
- **Binding:** `H = sha256(value‖nonce)`
- **Unlock:** round-R BLS verified on-chain before reveal
- **Selective disclosure:** values public post-R; identities auditor-encrypted

all done