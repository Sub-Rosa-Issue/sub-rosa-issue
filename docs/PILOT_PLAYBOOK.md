# Sub Rosa Pilot Playbook

## Positioning

Sub Rosa is escrow-backed sealed auction infrastructure for Stellar apps.

Bidders lock Stellar assets, submit bids that remain unreadable until a shared
Drand reveal round, and then Soroban clears the auction, pays the operator, and
refunds losing escrow deterministically.

## Pilot Goal

The pilot should answer one question:

> Does a real Stellar team need sealed on-chain bidding enough to run repeated
> rounds?

The pilot is not a generic demo of privacy. It is a focused test of whether
sealed auctions or competitive bid rounds create value for an operator and
participants.

## Target Pilot Profiles

Prioritize teams with funds movement or real competitive bids:

1. auction or marketplace operator;
2. asset issuer running a sale or allocation round;
3. procurement-style workflow where suppliers submit competitive bids;
4. Stellar ecosystem team awarding a paid bounty through sealed bids;
5. DeFi or intent-style app that needs sealed order collection before clearing.

Do not describe a partner as confirmed until they explicitly agree to run a
pilot or provide a written design-partner note.

## Pilot Scope

A good first pilot is small and measurable:

- 3 sealed auction rounds on Stellar testnet;
- 3-10 bidders per round;
- USDC or XLM SAC escrow;
- public round IDs and settlement receipts;
- operator feedback after each round;
- a final go/no-go decision for a capped mainnet beta.

## Success Criteria

| Question | Evidence |
| --- | --- |
| Did anyone need sealed bidding? | Partner explains the leakage or trust problem in their own words |
| Did settlement matter? | Bids were escrow-backed; winner payment and loser refunds are visible |
| Could an operator run it? | Partner creates or monitors a round with docs/support |
| Did participants understand it? | Bidders can commit, wait for R, and verify reveal |
| Is there repeat potential? | Partner wants another round, mainnet beta, or integration work |

## Outreach Message

> Sub Rosa won 1st Place in the Hack Privacy Track at Build On Stellar. We are
> narrowing the next SCF submission to one use case: escrow-backed sealed
> auctions on Stellar. Bidders lock assets, bids stay unreadable until a public
> Drand reveal, and Soroban settles the winner and refunds losers. Would you be
> open to a small testnet pilot for an auction, sale, bounty, or competitive bid
> workflow?

## Demo Narrative

The SCF-facing walkthrough should make the auction workflow obvious:

1. An operator creates a sealed auction round.
2. Bidders lock escrow and submit sealed bids.
3. No bidder or operator can read bids before Drand R.
4. Drand unlocks the reveal for the entire bid set.
5. Soroban validates commitments, selects the winning bid, pays the operator,
   and refunds losers.
6. The operator publishes a receipt with round ID, Drand R, bid set,
   settlement, and final contract balance.

## Pilot Report Template

For each pilot round, capture:

- partner/operator name;
- round ID and contract ID;
- asset and total escrow;
- number of bidders;
- winning bid and settlement amount;
- refund status;
- keeper action timestamp;
- participant/operator feedback;
- next action.

## Short Social Post

Sub Rosa is preparing focused Stellar pilots for escrow-backed sealed auctions:
bids stay hidden until a public Drand reveal, then Soroban settles the winner
and refunds losers.

If you run an auction, marketplace, asset sale, bounty, or competitive bid
workflow on Stellar, I would love to test a small round with you.
