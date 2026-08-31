# Instawards Statement of Work (SOW)
## 30-Day Scoped Engagement

**Network:** Stellar testnet (mainnet is a later phase).
**Scope:** The sealed-auction integration kit only (public receipt + template + 3 live rounds).
**Regulation Posture:** Non-custodial escrow, no yield.
**Drafting Method:** Drafted with an adversarial AI persona review method (not a team).

---

## 1. Project & Team Information

| Field | Details |
| --- | --- |
| **Project Name** | Sub Rosa |
| **Builder / Team Name** | Emin Karagoz |
| **Primary Contact (Name + Email)** | Emin Karagoz · eminkaragoz07@gmail.com |
| **Ambassador Chapter** | Stellar Türkiye |
| **Ambassador Chapter Lead** | İrem Koçi (Stellar Türkiye) |
| **Date Submitted** | 2026-07-12 |
| **Suggested Sprint Start Date** | 2026-07-15 |

### Supporting Links (Existing Work)

- GitHub repo: https://github.com/Sub-Rosa-Issue/sub-rosa-issue
- Live demo: https://sub-rosa-web.vercel.app
- Demo video: https://youtu.be/NDuR5B2ztQo
- Architecture: https://github.com/Sub-Rosa-Issue/sub-rosa-issue/blob/main/ARCHITECTURE.md
- Pitch deck: https://gamma.app/docs/SUB-ROSA-g8o9ulvc7nezz4j?mode=doc

---

## 2. Instawards Overview & Intent

### 2.1 Instawards Purpose (for Builder Context)

Instawards support short, clearly scoped, execution-focused work that helps a project make tangible progress toward building on Stellar — specific, achievable outcomes that can be completed and demonstrated within 30 days or less. This SOW is a shared commitment between the Builder and the Ambassador Chapter Lead on what will be delivered, why it matters, and how success will be verified.

---

## 3. Problem Statement & Objective

| Section | Description |
| --- | --- |
| **Problem Being Addressed** | Sealed-bid auctions need bids to stay secret until a fair reveal, and they need every bidder to trust that losers get refunded and the winner actually pays. Doing this on-chain normally means writing timelock cryptography, an escrow contract, and a keeper that reveals and settles on time — most builders never get past that wall. Sub Rosa already solved it: escrow-backed sealed-auction infrastructure on Stellar that won 1st Place in the Hack Privacy Track at Build On Stellar (IBW 2026). But the code being proven is not the same as it being usable. Today an outside builder still cannot verify an auction result from a single public link, and cannot run their own round from the docs. That gap is exactly what blocks real adoption. |
| **Objective of This Instaward** | After 30 days, Sub Rosa will have a live, end-to-end sealed-auction integration kit on Stellar testnet: any observer can verify a settled auction from one public receipt link, and any builder can run their own round from a copy-paste template. Completion is provable by publicly verifiable transaction hashes on a testnet explorer. <br><br> **Success metric (binary):** ≥ 3 verifiable, end-to-end testnet rounds — each a full commit → reveal → settle → refund cycle — with a public receipt link and on-chain settlement + refund transaction hashes anyone can look up on a testnet explorer. Pass = 3 receipts with matching tx hashes; there is no partial credit. <br><br> **Why this is achievable in 30 days:** This plan does not start from zero. The hard technical risks are already retired by Sub Rosa's hackathon-winning build — a working Soroban round contract, Drand-based timelock encryption (tlock), an escrow + refund flow, and an automated keeper that reveals and settles — with a passing test suite. The 30 days are about packaging proven parts into one public, click-to-verify kit, not discovering whether it can be done. |

---

## 4. Scope of Work (30-Day Deliverables)

### 4.1 In-Scope Deliverables

| Deliverable | Description (what will be built or produced) | Why this matters |
| --- | --- | --- |
| **D1: Public auction receipt (page + SDK module)** | An SDK module and public receipt page that turn any settled round into a single verifiable record: round ID, contract ID, Drand round, bidder count, escrow amount, winning bid, settlement + refund transactions, and Stellar Expert links. Covered by tests proving conservation — refunds plus operator payment always equal the escrow — so a reader can trust the numbers without reading the contract. | Anyone can open one link and confirm the auction settled fairly, with no code reading needed. This is the trust surface the whole kit rests on. |
| **D2: Integration template + quickstart** | A copy-paste template and step-by-step quickstart (install → create a round → commit a sealed bid → reveal with Drand → settle and refund) so an outside builder can run their own sealed auction on testnet without writing the timelock crypto, keeper, or escrow logic themselves. Driven end to end to create one real testnet round through the template. | Proves Sub Rosa is reusable infrastructure, not a one-off demo, and makes it trivial for a pilot partner to try. |
| **D3: Live testnet demo + 3 published receipts** | Deploy the demo publicly and run 3 sealed-auction rounds (3–10 bidders each) using XLM or USDC escrow, each a full commit → reveal → settle → refund cycle. Publish 3 full public receipts with settlement and refund transaction links, a public repo, and a short evidence pack (screenshots or a clip + a plain-language write-up of the lifecycle and known limits). | Creates real Stellar testnet activity and gives repeatable, independently verifiable proof of the full auction lifecycle — tx hashes, not just a screen recording. |

### Out of Scope (Explicitly Not Included)

- **Mainnet / real value** — testnet only; no real-value rounds this sprint.
- **Third-party security audit** — no external audit of the contracts or keeper.
- **Confirmed named pilot partner** — partner outreach is best-effort, not a required deliverable.
- **Production keeper infrastructure** — the keeper runs demo-grade; no HA deployment, alerting, or key-management/HSM setup.
- **New cryptographic primitives** — uses the existing Drand tlock and escrow design; no new crypto is designed or changed.
- **Governance / fee economics** — no operator-fee market, dispute resolution, or on-chain governance.
- **Production persistence & scale** — no production DB, multi-tenant operator dashboard, or high-throughput/anti-sybil hardening beyond demo needs.
- **Wallet / account UX beyond the demo** — no custom wallet, recovery, or onboarding flows outside the receipt and template pages.

### 4.2 Deliverable-Aligned Budget Request

| Requested Budget Amount | Rationale for Budget Request |
| --- | --- |
| **$5,000 USDC** | This Instaward funds execution, not exploration. The hard technical risks — sealed bidding, Drand timelock reveal, escrow, refunds, and an automated keeper — are already retired by Sub Rosa's hackathon-winning testnet build, so this 30-day scope is about packaging those proven building blocks into one public, verifiable integration kit, not researching whether it can be done. A 30-day solo builder stipend covers focused engineering across three shippable deliverables (public receipt page + SDK module, integration template with quickstart, and a live testnet demo), testnet operations (keeper runtime and transaction costs across 3 rounds), and production of the verifiable evidence pack. Tied directly to the three deliverables, each of which is publicly verifiable on completion. The amount is deliberately scoped to a single integration kit on testnet, with mainnet reserved for a later phase. |

---

## 5. 30-Day Execution Plan & Timeline

### 5.1 Weekly Breakdown

| Week | Planned Work | Expected Output |
| --- | --- | --- |
| **Week 1: Receipt module + conservation tests** <br>(de-risk the trust surface first) | Finish the SDK receipt module that reads a settled round on-chain and assembles the full record (round ID, contract ID, Drand round, bidder count, escrow, winning bid, settlement + refund txs, Stellar Expert links). Add the conservation tests (refunds + operator payment = escrow). Build the public receipt page rendering a real settled round. | Receipt module merged with passing conservation tests. Public receipt page showing one real settled testnet round with clickable, verifiable tx hashes. The trust surface is proven by end of Week 1. |
| **Week 2: Integration template + first round through it** | Build the copy-paste template and quickstart docs (install → create round → commit → reveal → settle/refund). Drive one real testnet round end to end through the template exactly as an outside builder would, using only the documented steps. | Public template and quickstart published. One testnet round created entirely through the template, with a receipt link proving it. D2 happy path works from docs alone. |
| **Week 3: Live demo deployed + 3 rounds run** | Deploy the demo to a public testnet URL. Run 3 sealed-auction rounds (3–10 bidders each) from commit through reveal, settle, and refund, using XLM or USDC escrow. Harden error handling and keeper config for repeatable runs. Publish/clean the public repo. | Live demo URL reachable. 3 completed rounds with on-chain settlement and refunds. Public repo published. D3 substantially complete. |
| **Week 4: Publish receipts + evidence pack** | Publish the 3 full public receipts, gather screenshots or a short clip, write the plain-language lifecycle + limits write-up, tidy the docs, and produce the wrap-up report. | 3 public receipt links + explorer tx hashes (settlement + refund per round). Evidence pack and short completion report published in the public repo. D1 + D2 + D3 closed; SOW deliverables shippable. |

---

## 6. Evidence of Completion (Required)

### 6.1 Planned Evidence to Be Submitted

| Deliverable | Evidence Type | Description |
| --- | --- | --- |
| **D1: Public auction receipt** | Live link + public repo + test output | Click the receipt link to open a public page showing a settled round's status, escrow, winning bid, and Stellar Expert links, all loading from on-chain data. Open the linked repo to see the receipt module and run the passing conservation tests yourself. |
| **D2: Integration template + quickstart** | Public template (repo) + testnet tx (link) | Open the template and quickstart in the public repo, then click the transaction link to confirm that one testnet round was created through it on a public testnet explorer. |
| **D3: Live demo + 3 receipts** | Live demo URL + 3 receipt links (tx hashes) + demo video | Open the live demo URL, then click each of the 3 public receipt links to confirm settlement and refund transactions on the public testnet explorer, and watch the short demo video (youtu.be/NDuR5B2ztQo) showing the full commit → reveal → settle → refund lifecycle. |

### 6.2 Evidence Verification Checklist (For Ambassador Use)

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
| --- | :---: | :---: | :---: | --- |
| D1: Public auction receipt | ☐ | ☐ | ☐ | |
| D2: Integration template + quickstart | ☐ | ☐ | ☐ | |
| D3: Live demo + 3 receipts | ☐ | ☐ | ☐ | |
