# Sub Rosa — SCF Build Plan

Sub Rosa won **1st Place in the Hack Privacy Track at Build On Stellar Hackathon
— IBW 2026** (Rise In × Stellar Development Foundation).
The next milestone is to turn the working prototype into production-ready
developer infrastructure for the Stellar ecosystem.

This document is written to be self-contained for Stellar Community Fund Build
review: project value, Stellar integration, readiness, deliverables, tranches,
and open-source plan.

## One-line positioning

Sub Rosa is verifiable allocation infrastructure for Stellar grants,
hackathons, bounties, RFPs, and sealed auctions: submit sealed inputs, reveal
publicly, and settle fairly.

## Problem

Public blockchains reveal information too early. That is harmful when the
process depends on participants not seeing each other's values before a
deadline:

- DAO votes and governance polls
- Sealed auctions and RFPs
- Grant scoring and bounty judging
- Token allocation and demand signaling
- Any allocation workflow where late actors can react to leaked inputs

The usual workaround is to trust an operator to keep data secret. Sub Rosa
removes that operator from the trust path.

## Pilot plan

Sub Rosa's first pilot will run with **OverBlock** as an internal
builder/community environment for sealed judging, bounty allocation, and
grant-style scoring workflows.

Beyond OverBlock, external pilot conversations will target Stellar ecosystem
teams, hackathon organizers, DAOs, and grant/RFP programs that need sealed
scoring, sealed bidding, or verifiable allocation workflows. The pilot plan and
outreach language are documented in `docs/PILOT_PLAYBOOK.md`.

## Solution

Sub Rosa lets applications create a timed sealed round on Soroban:

1. A round is created with a future Drand round `R`, deadlines, clearing rule,
   and auditor key.
2. Participants submit a commitment, timelock-encrypted ciphertext, auditor
   blob, and escrow.
3. Before `R`, values are on-chain but unreadable.
4. After Drand publishes `R`, anyone can submit the Drand BLS signature.
5. The Soroban contract verifies the signature on-chain, opens reveal, validates
   commitments, clears the round, and settles escrow/refunds deterministically.

The frontend is only the demo layer. The product is the protocol, Soroban
contract, SDK, keeper service, and integration templates.

## Why Stellar

Stellar is a core part of the product, not superficial storage:

- **Soroban** enforces the round state machine: create, commit, open reveal,
  reveal, clear, settle, void.
- **Stellar assets / SAC** provide escrow, winner settlement, and refunds.
- **Low-cost, fast finality** makes repeated sealed rounds practical for apps.
- **SDK + contract integration** lets other Stellar teams embed privacy/fairness
  without implementing cryptography themselves.

## Current proof

| Proof | Network | Status |
| --- | --- | --- |
| Round contract + tests | Local/Soroban | `pnpm contract:test` |
| tlock package + auditor blob | Local | `pnpm tlock:test` |
| SDK | Local/Testnet | Contract bindings + direct RPC submitter |
| Full lifecycle | Testnet | `pnpm lifecycle:e2e`: 2 bidders, USDC SAC, settle to 0 |
| Multi-agent + x402 | Testnet | `pnpm agents:e2e`: x402 appraisal, sealed commits, keeper reveal, settle |
| UI trace | Testnet | Canonical generated trace in `apps/web/src/demo/demo-trace.generated.ts` |
| Mainnet smoke | Mainnet | Real XLM deployment, BLS open, settle, read-only verify |
| Keeper | Testnet-ready | Permissionless reveal + watch mode |

Mainnet currently proves the primitive with native XLM SAC. The full USDC
multi-agent product proof is on testnet; this boundary is intentional and
documented in `docs/LIMITATIONS.md`.

## Build readiness

The repository already contains the major components:

- `contracts/round`: Soroban sealed-round primitive
- `packages/sdk`: TypeScript SDK for app integration
- `packages/tlock`: timelock seal/open helpers and auditor blob
- `services/keeper`: permissionless keeper and watch mode
- `services/agent`: autonomous bidder proof with mandate caps
- `services/appraisal-api`: x402-gated appraisal service
- `apps/web`: live jury demo and canonical trace explorer

SCF support would fund hardening, packaging, docs, pilot integrations, and
mainnet launch rather than basic prototype discovery.

## Open-source plan

Sub Rosa is intended to remain open source:

- Soroban contracts under `contracts/round`
- TypeScript packages under `packages/*`
- Keeper and demo services under `services/*`
- Integration docs, threat model, and deployment guide under `docs/*`

The production milestone includes publish-ready npm packages and versioned
contract artifacts so teams can audit and integrate the primitive.

## Tranches

### Tranche 1 — Developer infrastructure

Goal: make Sub Rosa easy for other Stellar developers to integrate locally and
on testnet.

Deliverables:

- Publish-ready `@sub-rosa/sdk` package surface and examples
- `@sub-rosa/tlock` integration examples for sealed values and auditor blobs
- Integration guide: "Add sealed rounds to a Stellar app"
- Contract hardening pass and expanded test vectors
- Clear API docs for create round, commit, open reveal, reveal, clear, settle

### Tranche 2 — Testnet pilots and operations

Goal: prove Sub Rosa as reusable infrastructure with realistic app flows.

Deliverables:

- Hosted keeper/reveal service for testnet pilots
- React hooks/components for wallet, countdown, commit, reveal, and receipts
- Pilot templates for DAO voting, sealed auction, grant scoring, and RFP flows
- Monitoring dashboard for round status, keeper actions, and settlement results
- Partner-facing docs and onboarding checklist

### Tranche 3 — Mainnet launch

Goal: launch Sub Rosa as production Stellar infrastructure.

Deliverables:

- Mainnet deployment of hardened contract artifacts
- Production keeper operations and runbook
- Mainnet integration example using real Stellar assets
- Security review/audit readiness package
- Versioned npm release and launch documentation

## Differentiation

Sub Rosa is not a generic privacy wallet or encrypted form. It is a timed
coordination primitive: secrecy exists only until it is fair to reveal. That
fits public blockchains because the final result can still be public,
verifiable, and settled on-chain.

The core value is fairness:

> Early information stays hidden. Final outcomes stay verifiable.
