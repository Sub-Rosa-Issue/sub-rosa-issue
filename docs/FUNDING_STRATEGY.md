# Funding Resubmission Notes

This document converts the earlier grant reviewer feedback into the next
submission strategy.

## What The Review Said

The panel did **not** reject the build quality. The feedback explicitly called
out strong engineering:

- working Soroban contract;
- on-chain Drand BLS12-381 verification;
- real tests;
- clean storage tiers;
- SAC escrow and settlement;
- permissionless lifecycle and void path;
- settled mainnet round.

The submission failed the Open Track bar because it did not prove a focused,
high-value use case with credible demand and volume.

## Core Fix

Do not pitch Sub Rosa as infrastructure for five workflows.

Pitch it as **escrow-backed sealed auction infrastructure for Stellar**.

This is the wedge where the current build is strongest:

- bidders need confidentiality before close;
- the winner needs to pay from locked escrow;
- losers need deterministic refunds;
- the operator should not custody private bids or decide settlement;
- the final result should be publicly auditable.

## What To Stop Leading With

These can remain as future examples, but should not lead the funding resubmission:

- grant scoring;
- hackathon judging;
- DAO polls;
- small trusted RFP review panels;
- broad "front-running" language without a Stellar-specific auction scenario.

The reviewer is right that many judging and RFP panels are small trusted groups
and do not obviously need on-chain settlement. Sub Rosa's stronger case is
where funds are locked and moved by the auction result.

## Pilot Evidence Needed Before Resubmission

The next submission should include at least one named demand signal:

- named design partner;
- pilot agreement;
- letter/email saying they will test a sealed auction or bid round;
- public testnet pilot report with external participants.

Minimum useful pilot evidence:

| Evidence | Why it matters |
| --- | --- |
| Partner name | Shows demand is not only claimed |
| Workflow description | Shows why sealed settlement is needed |
| Round IDs | Lets reviewers verify usage |
| Total escrow | Shows settlement value, even on testnet |
| Participant count | Shows coordination beyond one builder |
| Feedback quote or summary | Shows learning and buying intent |
| Next decision | Shows whether this can become repeated usage |

## Outcome-Based Milestones

Replace output-only deliverables with outcomes:

- one named auction or competitive bid pilot selected;
- at least three testnet sealed auction rounds run with the pilot;
- public receipts for round creation, commitments, reveal, clear, settle, and
  refunds;
- one external team can run the flow using docs and SDK;
- one external Soroban/Rust reviewer reviews funds-handling paths before mainnet
  beta;
- capped mainnet beta only after review and pilot feedback.

## Single-Builder Risk Answer

Suggested response:

> The current implementation was built by one builder, so the resubmission
> treats external review as a milestone, not an afterthought. Grant funds would
> support an independent Soroban/Rust review of the funds-handling paths,
> capped mainnet pilots, public runbooks, reproducible e2e scripts, and at
> least one additional technical reviewer before production launch.

## Draft Resubmission Paragraph

Sub Rosa is now focused on one wedge: escrow-backed sealed auctions on Stellar.
The protocol lets bidders lock Stellar assets, submit bids that remain
unreadable until a public Drand round, and then have Soroban verify, clear,
settle the winner payment, and refund losers deterministically. We are no
longer asking funders to fund a broad allocation primitive across grants,
hackathons, DAOs, RFPs, and auctions. The resubmission will include a named
auction/design-partner pilot, public testnet round receipts, and an external
review milestone for the funds-handling contract before any uncapped mainnet
usage.

## Immediate To-Do

- Get one named pilot or written design-partner signal.
- Update public demo to open with the sealed auction case.
- Publish a short pilot ask targeted at auction, marketplace, procurement, or
  asset-issuer teams.
- Produce one pilot report template before outreach starts.
- Ask one Soroban/Rust engineer for review availability and budget.
