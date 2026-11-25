# Sub Rosa Rounds — Escrow-Backed Sealed Auctions on Stellar

## One-Sentence Pitch

Sub Rosa lets Stellar teams run escrow-backed sealed auctions where bids stay private until the deadline, reveal verifiably with Drand, and settle/refund on-chain through Stellar assets.

## Products & Services

Sub Rosa Rounds is a focused product for escrow-backed sealed auctions on Stellar.

An auction creator opens a sealed auction round with the auction rules, deadline, settlement asset, and Drand reveal round. Bidders connect a Stellar wallet, lock escrow, and submit encrypted sealed bids before the deadline. Bid values remain hidden during the commit phase, so neither the auctioneer nor competing bidders can inspect the bid book early.

When the configured Drand round is published, the auction can be opened for reveal. The Soroban contract verifies the Drand unlock condition, checks each revealed bid against its original commitment, and clears the auction according to the configured rule. The highest valid bid wins. The winner's escrow settles to the auctioneer through Stellar assets, and losing bidders are refunded deterministically.

Every auction produces a public receipt that can include:

- auction id;
- contract id;
- Drand round;
- bidder count;
- commit transactions;
- reveal transactions;
- settlement transaction;
- refund transactions;
- escrowed amount;
- winning bid;
- final status;
- Stellar Expert links where available.

The product surface for SCF #45 is intentionally narrow:

- sealed auction creation;
- sealed bid submission;
- Drand-gated reveal;
- on-chain bid verification;
- Stellar asset escrow;
- winner settlement;
- loser refunds;
- public auction receipts;
- pilot integration kit for a Stellar builder/design partner.

Adjacent future use cases such as grants, judging, DAO voting, RFP review, bounties, and broader allocation workflows may reuse the same primitive later, but they are not the focus of this SCF #45 submission.

## Why This Matters For Stellar

Sub Rosa Rounds turns sealed auctions into real Stellar activity.

Each auction can create multiple Stellar transactions:

- auction round creation;
- bidder escrow and sealed bid commits;
- Drand-gated reveal calls;
- winner settlement;
- loser refunds;
- public receipt verification.

Stellar Asset Contracts are used for escrow, settlement, and refunds. This means the auction is not only a privacy demo or encrypted form. It is a transaction-generating auction product where Stellar assets move through a deterministic, auditable lifecycle.

For Stellar builders, Sub Rosa provides a reusable way to run fair sealed auctions without building cryptography, keeper operations, commitment verification, escrow accounting, and refund logic from scratch. It is useful for teams that need to allocate or sell a limited asset, access right, sponsorship slot, service slot, or high-value opportunity through sealed bids.

The value to Stellar is practical:

- more Soroban contract usage;
- more Stellar asset movement;
- a reusable auction pattern for ecosystem builders;
- public receipts that make auction outcomes verifiable;
- a focused product that can be piloted with one real builder before expanding.

## SCF #44 Feedback Response

SCF #44 feedback was useful: the engineering was considered strong, but the submission needed a narrower first use case, real traction, and outcome-based deliverables. SCF #45 is a focused resubmission to prove one use case: escrow-backed sealed auctions on Stellar.

The SCF #44 review recognized the strength of the build: a working Soroban contract, on-chain Drand BLS12-381 verification, tests, SAC escrow and settlement, a permissionless lifecycle, a void grace path, and a settled mainnet round. The gap was not technical effort. The gap was focus and adoption evidence.

This resubmission responds directly:

- the product is narrowed to escrow-backed sealed auctions;
- broad use cases are demoted to future adjacent possibilities;
- the roadmap is based on pilot outcomes, not only code outputs;
- the pilot plan requires a named Stellar builder/design partner;
- funds-handling risk is addressed explicitly through caps, documentation, and external review planning.

## Current Traction Evidence

Sub Rosa already has technical validation:

- 1st Place in the Hack Privacy Track at Build On Stellar Hackathon — IBW 2026;
- Soroban sealed-round contract;
- Drand/tlock bid privacy;
- on-chain BLS verification for reveal gating;
- TypeScript SDK;
- permissionless keeper;
- frontend demo;
- Stellar Asset Contract escrow, settlement, and refunds;
- testnet full lifecycle proof;
- mainnet smoke proof with a settled round.

Evidence links to fill before final submission:

- Live demo URL: TODO
- GitHub URL: TODO
- Testnet contract URL: TODO
- Mainnet smoke proof URL: TODO
- Public auction receipt example: TODO
- Pilot/design partner evidence: TODO

TODO before final SCF #45 submission: add named pilot/design partner and pilot evidence links.

No named pilot, partner, revenue, or confirmed integration should be claimed until it is real and linkable.

## Pilot Plan

The SCF #45 pilot plan is to validate one focused question:

> Does a real Stellar builder need escrow-backed sealed auctions enough to run repeated rounds?

Pilot target:

- 1 named Stellar builder/design partner;
- 3 testnet sealed auction rounds;
- 3-10 bidders per round;
- XLM or USDC Stellar Asset Contract escrow;
- public auction receipts;
- settlement/refund transaction links;
- pilot report;
- go/no-go decision for a capped mainnet beta.

The target partner should have a real auction or competitive bid workflow, such as:

- selling or allocating a limited asset;
- assigning a sponsorship or access slot;
- awarding a high-value opportunity through sealed bids;
- running a competitive sale or marketplace round;
- testing a sealed bid flow before a capped mainnet beta.

Pilot success will be measured by:

- number of completed auction rounds;
- unique bidder wallets;
- commit transactions;
- reveal transactions;
- settlement transactions;
- refund transactions;
- total escrowed value;
- total settled value;
- public receipt completeness;
- partner feedback;
- decision on whether to continue to capped mainnet testing.

## Budget Request

Requested SCF #45 budget: **$40,000**

This is intentionally lean. The goal is not to fund the whole long-term Sub Rosa platform. The goal is to prove one concrete use case: escrow-backed sealed auctions on Stellar.

Proposed budget allocation:

| Area | Amount | Purpose |
| --- | ---: | --- |
| Focused sealed auction MVP | $12,000 | Auction-specific UX, receipt page, docs, and integration polish |
| Pilot integration and support | $10,000 | Work with one named Stellar builder/design partner, run testnet rounds, collect feedback |
| Keeper, monitoring, and evidence | $5,000 | Pilot keeper operations, transaction links, metrics, receipt/evidence tracking |
| Security and funds-risk readiness | $8,000 | Funds-handling documentation, invariant tests, external Soroban review plan or reviewer identification |
| Mainnet beta preparation and reporting | $5,000 | Capped mainnet pilot plan, final pilot report, SCF reporting, launch readiness docs |
| **Total** | **$40,000** | Focused proof of one use case |

## Deliverable Roadmap

### Tranche #1 — Focused Sealed Auction MVP

Deliver:

- sealed auction round creation;
- sealed bid commit/reveal;
- Stellar asset escrow/refund/settlement;
- public auction receipt page;
- updated demo and docs.

Completion evidence:

- live demo;
- GitHub release;
- contract address;
- test results;
- receipt example.

Outcome:

- A Stellar builder can understand and try the sealed auction flow without interpreting Sub Rosa as a generic privacy protocol.

### Tranche #2 — Pilot Integration

Deliver:

- secure one named Stellar builder/design partner;
- run at least one public testnet sealed auction pilot;
- publish transaction links and receipt;
- collect partner feedback;
- publish pilot report.

Completion evidence:

- partner name or documented pilot scope;
- public testnet round links;
- receipt links;
- partner feedback quote or summary;
- pilot report.

Outcome:

- Sub Rosa proves whether a real Stellar team needs escrow-backed sealed auctions in a concrete workflow.

### Tranche #3 — Mainnet Readiness and Capped Beta

Deliver:

- capped-value mainnet pilot plan;
- security/funds-handling risk documentation;
- external Soroban review plan or reviewer identified;
- admin/key/keeper documentation;
- void/refund path documentation;
- final pilot report and SCF report.

Completion evidence:

- risk documentation;
- review checklist;
- capped mainnet plan;
- final report;
- updated docs.

Outcome:

- Sub Rosa is ready for a limited, capped mainnet beta only after pilot evidence and funds-handling review planning are in place.

## Single-Builder Risk Mitigation

The current project is solo-built, and funds-handling risk is real. SCF #45 should not pretend otherwise.

Risk mitigation plan:

- early pilots use capped values;
- mainnet pilot usage remains capped and opt-in;
- external Soroban review is required before higher-value or uncapped use;
- admin, upgrade, and keeper keys are documented;
- keeper role is for liveness, not trust;
- void/refund paths are documented and tested;
- invariant tests and threat model are maintained;
- public receipts make settlement/refund behavior inspectable;
- no external audit cost is claimed unless it is actually included and scoped;
- production launch requires review before larger-value auctions.

Funds-handling scope for the pilot:

- testnet is the primary pilot environment;
- any mainnet beta must use capped value;
- the contract must preserve deterministic settlement and refund behavior;
- if reveal cannot complete, the void/refund path must be documented and usable.

## What This Submission Does Not Claim

This SCF #45 submission does not claim:

- a confirmed named pilot unless one is actually secured;
- fake revenue;
- fake partner commitments;
- a completed production integration;
- a completed external audit;
- support for every private coordination use case as the main product.

The project is intentionally focused on one wedge for this round: escrow-backed sealed auctions on Stellar.

## Final Submission Checklist

Before submitting to SCF #45, fill in:

- live demo URL;
- GitHub URL;
- testnet contract URL;
- mainnet smoke proof URL;
- at least one public auction receipt example;
- named pilot/design partner, if secured;
- pilot scope or written design-partner note;
- final budget confirmation;
- final tranche dates;
- reviewer or review-plan details for funds-handling risk.

## Copy-Paste Summary

Sub Rosa Rounds is a focused SCF #45 resubmission for escrow-backed sealed auctions on Stellar. Bidders lock Stellar assets and submit encrypted sealed bids before the deadline. Bids stay private until a configured Drand round, then reveal verifiably. Soroban checks each reveal against the original commitment, clears the highest valid bid, settles the winner payment through Stellar assets, and refunds losing bidders. Every auction produces a public receipt.

SCF #44 feedback was useful: the engineering was strong, but the first submission was too broad and lacked pilot evidence. SCF #45 narrows the product to one concrete, transaction-generating Stellar use case and uses outcome-based deliverables: a focused auction MVP, one named builder/design-partner pilot, public testnet auction receipts, partner feedback, funds-handling risk documentation, and capped mainnet beta readiness.
