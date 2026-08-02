# Sub Rosa Partner-Ready Platform Plan

## Objective

Bring Sub Rosa to a point where a new Stellar project can run a credible pilot
through configuration, a hosted flow, or a small SDK integration instead of a
partner-specific protocol rewrite.

The product and the platform deliberately have different scopes:

- **Product wedge:** escrow-backed sealed auctions on Stellar.
- **Platform capability:** reusable sealed rounds with structured submissions,
  verifiable reveal, eligibility policies, receipts, and audited settlement
  templates.

The focused product wedge answers the SCF Open Track feedback. The reusable
platform, templates, verification, and APIs answer the builder feedback without
turning the funding narrative back into five equal use cases.

## Positioning rule

Every public funding or product narrative must lead with sealed auctions. Other
workflows are integration evidence or future templates, not separate products.

> Sub Rosa is embeddable sealed-auction infrastructure for Stellar. Its shared
> round SDK can also support partner workflows that need private submissions and
> a verifiable simultaneous reveal.

## Target integration experience

A partner chooses the lightest integration that fits its capacity:

| Mode | Partner effort | Sub Rosa surface |
| --- | --- | --- |
| Hosted pilot | No production code change | Hosted round URL |
| Embedded flow | Small UI change | Widget or web component |
| Native integration | Full product control | TypeScript SDK |
| Operations integration | Backend automation | Read API and webhooks |

Wallet signatures and encryption remain client-side. A hosted API must never
custody partner or participant signing keys.

## Architecture target

```text
Sealed Round Core
  - versioned structured payload commitment
  - Drand-gated reveal
  - deadlines and eligibility
  - supported selection rules
  - canonical public receipts

Verified Settlement Templates
  - no settlement / reveal receipt
  - forward auction
  - atomic asset sale
  - reverse procurement (after the auction pilot)

Integration Layer
  - @sub-rosa/tlock
  - @sub-rosa/sdk
  - hosted round application
  - read API, event indexer, and webhooks
  - partner templates
```

Settlement extensions must not become an unaudited arbitrary-callback system.
The production SDK and hosted UI will recognize versioned, reviewed adapter code
hashes and clearly reject or warn on unverified deployments.

## Supported templates

Templates configure one protocol; they do not fork it.

| Template | Submission | Selection | Settlement | Role in evidence |
| --- | --- | --- | --- | --- |
| Asset auction | Amount plus lot metadata | Highest valid bid | Payment to seller; lot to winner | Primary product and economic pilot |
| Sealed proposal | Price, timeline, approach | Organizer choice | None in first pilot | SDK/design-partner proof |
| Procurement | Price plus proposal | Lowest bid or organizer choice | Sponsor escrow to provider | Later reviewed template |

Grants, voting, judging, and other broad coordination examples do not lead the
SCF resubmission.

## Partner-ready completion gate

Sub Rosa is ready for repeatable outreach when all of the following are true:

### Protocol and security

- Structured payloads are versioned and byte-deterministic.
- Commitments bind the complete revealed submission, not only an amount.
- Seal TTL is valid through the configured reveal window.
- Settlement cannot exceed Soroban resource limits for the supported cohort.
- Escrow policy does not disclose the exact sealed bid by default.
- Round assets, void paths, and refunds conserve funds under tests.
- Production limits and unaudited boundaries are explicit.

### SDK and integration

- `@sub-rosa/tlock` supports generic sealed payloads and legacy bids.
- `@sub-rosa/sdk` exposes high-level round and template APIs.
- Packages build as publishable artifacts with versioned exports.
- A hosted pilot works without changes to a partner's production codebase.
- Read API and receipts expose round status without private keys.
- Webhooks provide reveal, clear, settle, and void lifecycle notifications.
- A fresh integrator can complete the documented sandbox flow in one session.

### Product evidence

- One named design partner completes a structured-submission testnet pilot.
- One named economic partner completes an escrow-backed auction pilot.
- Each pilot publishes round IDs, participant count, receipts, and feedback.
- The economic pilot reports total escrow and settlement/refund results.
- A partner provides a written go/no-go or next-step decision.
- A qualified external reviewer is named before capped mainnet funds.

## Delivery sequence

### 1. Versioned payload foundation

- Define a domain-separated binary envelope for optional amount, nonce, and
  arbitrary application payload bytes.
- Keep the existing 48-byte bid format available for deployed v1 contracts.
- Add deterministic vectors, malformed-input tests, and a live Drand roundtrip.

**Exit:** proposal and auction metadata can be sealed, opened, and committed to
without ambiguous serialization.

### 2. Sealed Round Core v2

- Add round/template versioning and a schema reference.
- Verify the full payload commitment on reveal.
- Add explicit auction and receipt-only lifecycle behavior.
- Make TTL policy deadline-aware and bound supported round duration.
- Replace unsafe all-bidder settlement assumptions with a measured cohort cap
  or batched/claim-based completion path.

**Exit:** contract tests prove reveal integrity, liveness, and resource-safe
completion for the published limits.

### 3. Settlement templates

- Move payment asset selection to round configuration.
- Implement forward-auction settlement first.
- Implement atomic lot custody and payment-for-asset exchange.
- Return lot and bidder funds on every void/no-bid path.
- Add a privacy-preserving escrow policy such as a uniform auction cap.

**Exit:** a testnet asset auction atomically pays the seller and transfers the
lot to the winner with loser refunds.

### 4. SDK v2

- Add high-level `createRound`, `submit`, `getStatus`, and `getReceipt` APIs.
- Add typed template builders and wallet/signer adapters.
- Produce publishable ESM artifacts and stable package exports.
- Retain low-level contract access for advanced integrators.

**Exit:** partner code uses a template API rather than raw Soroban binding
arguments.

### 5. Hosted integration and API

- Build organizer, participant, reveal, comparison, and receipt views.
- Add hosted round links and an embeddable surface.
- Add a read-only indexer/API and signed lifecycle webhooks.
- Never accept participant secret keys in the service.

**Exit:** a partner can run a testnet pilot without changing its production
codebase.

### 6. First design-partner pilot

- Run a generic service-proposal flow suitable for The Signal.
- Support configurable price, timeline, and approach fields.
- Record at least one realistic request and three external submissions.
- Publish a receipt and collect structured product feedback.

**Exit:** a named partner validates the SDK and hosted integration experience.

### 7. Economic auction pilot

- Confirm a forward-auction partner and representative asset.
- Run at least one auction with three external bidders.
- Publish escrow, atomic asset settlement, refunds, and partner feedback.

**Exit:** the primary product demonstrates real external demand and meaningful
on-chain settlement.

### 8. Review and capped mainnet path

- Prepare threat model, invariants, resource measurements, and deployment hashes.
- Complete an independent Soroban/Rust review.
- Resolve findings and run a capped, opt-in mainnet auction.

**Exit:** production claims are supported by review evidence and a deliberately
limited real-asset deployment.

## Outcome metrics

Engineering outputs alone do not close the SCF feedback. Track and publish:

- named partners and their exact commitment level;
- time and code required for integration;
- external participants per round;
- completed, voided, and failed rounds;
- escrow and settled volume;
- refund correctness;
- partner feedback and go/no-go decisions;
- security review scope and resolved findings.

## Current scope boundary

The existing v1 mainnet and testnet artifacts remain historical protocol proof.
They must not be silently described as the future modular platform. Core v2,
settlement templates, SDK v2, and their deployment hashes will be versioned and
documented separately.
