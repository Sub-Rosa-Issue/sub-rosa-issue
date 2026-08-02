# Sub Rosa — Build Plan

Sub Rosa won **1st Place in the Hack Privacy Track at Build On Stellar
Hackathon — IBW 2026** (Rise In x Stellar Development Foundation).

Early grant feedback said the engineering quality was strong, but the initial
scope was too broad and did not yet prove demand. This plan narrows the next
funding submission to one wedge: **escrow-backed sealed auctions on Stellar**.

## One-Line Positioning

Sub Rosa is sealed auction infrastructure for Stellar apps: bidders escrow real
assets, submit unreadable bids, and a Soroban contract reveals, clears, settles,
and refunds deterministically after a public Drand round.

## What Changed After Early Grant Feedback

The previous submission led with grants, hackathons, bounties, RFPs, DAO voting,
token allocation, and sealed auctions. That made the use case look generic.

The resubmission should lead with one use case that actually needs on-chain
settlement:

- **Primary wedge:** escrow-backed sealed auctions and competitive bid rounds.
- **De-scoped from the main pitch:** judging panels, grant scoring, DAO polls,
  and small trusted RFP committees.
- **Reason:** auction winners need to pay, losers need refunds, and no operator
  should be able to read bids early or choose who settles.

Other workflows can remain examples in integration docs, but they should not be
the core value claim.

## Problem

Auction operators on public ledgers face a bad tradeoff:

- visible bids leak the current clearing price before close;
- private off-chain bids require trusting the operator;
- winners can default if funds are not locked before reveal;
- losers need deterministic refunds;
- participants need a public receipt proving the final set of bids and the
  settlement path.

Sub Rosa solves this for Stellar-native auctions by combining timed
confidentiality with SAC escrow.

## Solution

Sub Rosa lets an application create a sealed auction round on Soroban:

1. The operator creates a round with a future Drand round `R`, commit deadline,
   reveal window, clearing rule, asset, and auditor key.
2. Bidders submit `H = sha256(value || nonce)`, a tlock ciphertext sealed to
   `R`, an auditor blob, and SAC escrow.
3. Before `R`, the bid values are on-chain but unreadable.
4. After Drand publishes `R`, anyone can submit the Drand BLS signature.
5. The Soroban contract verifies the signature on-chain, opens reveal,
   validates commitments, clears the auction, transfers the winning escrow to
   the operator, and refunds losers.
6. If reveal cannot complete, the round can be voided after grace and escrow is
   refunded.

The demo frontend is only the showcase. The product is the Soroban contract,
TypeScript SDK, tlock package, keeper service, runbooks, and integration
templates for auction operators.

## Why Stellar

Stellar is in the critical path:

- **Soroban** enforces create, commit, open reveal, reveal, clear, settle, and
  void.
- **Stellar Asset Contracts** provide escrow, winner payment, and loser refunds.
- **Fast, low-cost finality** makes repeated auction rounds practical.
- **Native asset rails** let auction apps settle in XLM, USDC, or other Stellar
  assets without a separate payment system.

## Current Proof

| Proof | Network | Status |
| --- | --- | --- |
| Round contract + tests | Local/Soroban | 14 Rust tests |
| tlock package + auditor blob | Local | 13 tests |
| SDK | Local/Testnet | Contract bindings + direct RPC submitter |
| Full lifecycle | Testnet | `pnpm lifecycle:e2e`: 2 bidders, USDC SAC, settle to 0 |
| Multi-agent + x402 | Testnet | `pnpm agents:e2e`: appraisal, sealed commits, keeper reveal, settle |
| UI trace | Testnet | Canonical generated trace in `apps/web/src/demo/demo-trace.generated.ts` |
| Mainnet smoke | Mainnet | Real XLM deployment, BLS open, settle, read-only verify |
| Keeper | Testnet-ready | Permissionless reveal + watch mode |

Mainnet currently proves the primitive with native XLM SAC. The full USDC
multi-agent auction proof is on testnet; this boundary is intentional and
documented in `docs/LIMITATIONS.md`.

## Resubmission Gate

Do not resubmit as a broad allocation primitive. Resubmit only after at least
one of these is true:

- a named Stellar ecosystem team agrees to run a sealed auction or competitive
  bid pilot;
- a marketplace, asset issuer, or procurement-style workflow provides a written
  design-partner note;
- a public testnet pilot has real external participants, round IDs, total
  escrow, settlement receipts, and feedback.

The application should include the named pilot or design partner, not only a
plan to find one.

## Outcome Commitments

The next funding request should include outcome milestones, not only build
outputs:

| Milestone | Outcome evidence |
| --- | --- |
| Pilot selection | Named pilot/design partner, public scope, and success criteria |
| Testnet auction pilot | At least 3 sealed auction rounds, public round IDs, total escrow, settle/refund receipts |
| Integrator readiness | One external team can create a round, collect bids, and verify settlement from docs |
| Security readiness | External Soroban/Rust review or audit-readiness report before uncapped mainnet funds |
| Adoption signal | Written partner feedback and a go/no-go decision for mainnet beta |

## Single-Builder Risk Mitigation

The project currently has single-builder risk. The resubmission should address
it directly:

- fund an external review of the Soroban contract and funds-handling paths;
- keep early mainnet pilots capped and opt-in;
- publish deployment, keeper, void, and emergency runbooks;
- keep the protocol open source with reproducible e2e scripts;
- separate demo claims from production guarantees;
- add at least one technical reviewer or maintainer before production launch.

## Build Readiness

The repository already contains the major components:

- `contracts/round`: Soroban sealed-round primitive
- `packages/sdk`: TypeScript SDK for app integration
- `packages/tlock`: timelock seal/open helpers and auditor blob
- `services/keeper`: permissionless keeper and watch mode
- `services/agent`: autonomous bidder proof with mandate caps
- `services/appraisal-api`: x402-gated appraisal service
- `apps/web`: live sealed auction demo and canonical trace explorer

Grant support would fund hardening, packaging, pilot integration, external
review, and a capped mainnet beta rather than basic prototype discovery.

## Tranches

### Tranche 1 — Auction Integration Package

Goal: make one sealed auction easy to integrate locally and on testnet.

Deliverables:

- Publish-ready `@sub-rosa/sdk` package surface and sealed auction examples
- `@sub-rosa/tlock` examples for bid values and auditor blobs
- Integration guide: "Add an escrow-backed sealed auction to a Stellar app"
- Contract hardening pass and expanded auction test vectors
- Public API docs for create round, commit, open reveal, reveal, clear, settle,
  and void

Outcome:

- one external developer can run the auction flow from docs without the demo UI.

### Tranche 2 — Named Testnet Pilot

Goal: prove that a real team needs the workflow.

Deliverables:

- Hosted keeper/reveal service for the pilot
- Operator dashboard for round status, keeper actions, escrow, and receipts
- Pilot onboarding docs and support
- Public pilot report with round IDs, participants, escrow, settlement, and
  feedback

Outcome:

- at least one named design partner completes a sealed auction or competitive
  bid pilot on testnet.

### Tranche 3 — Capped Mainnet Beta

Goal: launch a limited production path with real Stellar assets.

Deliverables:

- Reviewed mainnet contract artifacts
- Production keeper runbook and monitoring
- Capped mainnet auction example using a real Stellar asset
- Security review/audit package
- Versioned npm release and launch documentation

Outcome:

- one capped mainnet auction round settles successfully, or the partner pilot
  produces a documented no-go decision with findings.

## Differentiation

Sub Rosa is not a generic privacy wallet or encrypted form. It is a timed,
escrow-backed auction primitive: bids are hidden only until it is fair to
reveal, then the result is public, verifiable, and settled on Stellar.

The core value is fairness with settlement:

> Bids stay hidden before close. Funds settle publicly after reveal.
