# Sub Rosa Pilot Playbook

## Positioning

Sub Rosa is verifiable allocation infrastructure for Stellar grants,
hackathons, bounties, RFPs, and sealed auctions.

It keeps scores, bids, and allocation inputs unreadable until a shared reveal
time, then produces a public result that can be verified and settled on
Soroban.

## First internal pilot: OverBlock

OverBlock will be Sub Rosa's first internal pilot environment, using it for
sealed judging, bounty allocation, and grant-style scoring workflows.

The internal pilot should validate:

- whether organizers can create and monitor a sealed scoring round;
- whether judges understand the commit and reveal flow;
- whether sealed inputs reduce anchoring and late-score influence;
- whether the final result, settlement/refund state, and receipt are clear;
- what an external organizer needs to integrate or operate the workflow.

## External pilot ask

Target five small pilot conversations:

1. Rise In / Build on Stellar organizer
2. Stellar hackathon organizer
3. SCF or Stellar ecosystem builder
4. DAO or community operator
5. Project distributing grants or bounties

Suggested message:

> Sub Rosa won 1st Place in the Hack Privacy Track at Build On Stellar. We are
> now turning the protocol into verifiable allocation infrastructure for
> sealed judging, bounty allocation, grant scoring, RFPs, and sealed auctions
> on Stellar. Would you be open to a small pilot using one upcoming judging or
> allocation workflow?

Do not describe an external pilot as confirmed until the organizer explicitly
agrees to run it.

## SCF-style demo narrative

The SCF-facing walkthrough should make the allocation workflow obvious:

1. Five projects enter a grant round.
2. Three judges submit sealed scores.
3. Scores remain unreadable until the reveal time.
4. Drand unlocks the reveal and the final result becomes public.
5. Soroban shows deterministic settlement and refunds.
6. The organizer receives a public proof/receipt for the round.

The current live grant-scoring case demonstrates the sealed-score primitive.
The next demo iteration should add the multi-project allocation view and a
single organizer receipt that ties scoring, result, and settlement together.

## Identity Recovery (Auditor CLI)

During pilot operations, organizers must be able to prove that the designated auditor can securely recover participant identities from the public selective-disclosure trace without running complex UI scripts. We provide a dedicated CLI for this:

```bash
# Parse a generated trace and extract identities using the auditor secret
npm run recover --workspace @sub-rosa/tlock -- --trace apps/web/src/demo/demo-trace.generated.ts --secret <64-char-hex-secret>

# Or decode a single blob manually
npm run recover --workspace @sub-rosa/tlock -- --blob <hex-blob> --secret <64-char-hex-secret>
```

This ensures pilot operators can independently and verifiably execute the identity recovery phase and output structured JSON data of the recovered bidders.

## Short social post

Sub Rosa won 1st Place in the Hack Privacy Track at Build On Stellar. We are
now preparing small Stellar pilots for sealed judging, bounty allocation, and
grant-style scoring: inputs stay hidden until reveal, then the result is
publicly verifiable and settled on Soroban.

If you run a hackathon, grant, bounty, DAO, or RFP workflow, would you be open
to a small pilot?
