#![no_std]

//! # Sub Rosa — Round
//!
//! A reusable Soroban primitive for confidential commit → verifiable-reveal →
//! on-chain-settle coordination rounds. Bids are sealed with Drand timelock
//! encryption until a future round R that nobody controls; round R's threshold
//! signature is verified on-chain (BLS12-381) to force a simultaneous reveal.
//! The protocol — not the operator — owns fairness.
//!
//! No mocks, no fallbacks: every gate is a real on-chain check.

mod drand;
mod storage;
mod types;

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env, Vec,
};

use storage::*;
use types::*;

const MAX_CIPHERTEXT: u32 = 4096;
const MAX_AUDITOR_BLOB: u32 = 2048;
const MAX_AUDITOR_PUBKEY: u32 = 1024;
/// Cap on distinct bidders per round so the persisted bidder index stays well
/// within the contract data-entry size ceiling (PRD §8).
const MAX_BIDDERS: u32 = 500;
/// Grace window (seconds) after the reveal deadline before a stuck round
/// (e.g. Drand never produced R) can be voided and all escrow refunded.
const VOID_GRACE: u64 = 3600;
/// Maximum page size for paginated getters. Prevents resource exhaustion.
const MAX_PAGE_SIZE: u32 = 100;

#[contract]
pub struct SubRosaRound;

#[contractimpl]
impl SubRosaRound {
    /// One-time deploy configuration. All Drand parameters are supplied by the
    /// deployer from values validated against a live quicknet round.
    pub fn __constructor(
        env: Env,
        drand_pubkey: BytesN<192>,
        g2_neg_generator: BytesN<192>,
        dst: Bytes,
        drand_genesis: u64,
        drand_period: u64,
        usdc: Address,
    ) {
        if is_initialized(&env) {
            panic_with(&env, Error::AlreadyInitialized);
        }
        let config = GlobalConfig {
            drand_pubkey,
            g2_neg_generator,
            dst,
            drand_genesis,
            drand_period,
            usdc,
        };
        set_config(&env, &config);
        bump_instance(&env);
    }

    /// Open a new sealed round. Permissionless: anyone can be an operator, and
    /// the operator gets no special read power — that is the point.
    pub fn create_round(
        env: Env,
        operator: Address,
        item_ref: BytesN<32>,
        reveal_round: u64,
        clearing_rule: ClearingRule,
        commit_deadline: u64,
        reveal_deadline: u64,
        auditor_pubkey: Bytes,
        asset_config: RoundAssetConfig,
    ) -> Result<u64, Error> {
        operator.require_auth();
        let config = get_config(&env)?;
        bump_instance(&env);

        if reveal_round == 0 {
            return Err(Error::InvalidSealRoundZero);
        }
        if auditor_pubkey.len() > MAX_AUDITOR_PUBKEY {
            return Err(Error::PayloadTooLarge);
        }

        let now = env.ledger().timestamp();
        // Reject a reveal round the quicknet chain can never publish before any
        // deadline comparison: genesis + period×R must fit in u64. A saturating
        // placeholder here would let an overflowing round pass the deadline
        // checks and strand the round past the void grace window.
        let t_reveal = drand::checked_time_of_round(&config, reveal_round)
            .ok_or(Error::InvalidSealRoundZero)?;

        // Commit must close strictly before R is published, otherwise a bidder
        // could decrypt others' sealed bids before committing.
        if commit_deadline >= t_reveal {
            return Err(Error::CommitDeadlineAfterReveal);
        }
        if reveal_deadline <= t_reveal {
            return Err(Error::CommitDeadlineAfterReveal);
        }
        if commit_deadline <= now {
            return Err(Error::DeadlineInPast);
        }

        let round_id = next_round_id(&env);
        let round = Round {
            operator: operator.clone(),
            item_ref,
            reveal_round,
            clearing_rule,
            commit_deadline,
            reveal_deadline,
            auditor_pubkey,
            status: Status::Open,
            bidders: Vec::new(&env),
            winner: None,
            winning_bid: 0,
            asset_config,
        };
        set_round(&env, round_id, &round);

        env.events().publish(
            (symbol_short!("created"), round_id),
            (operator, reveal_round, commit_deadline),
        );
        Ok(round_id)
    }

    /// Submit (or overwrite, before the deadline) a sealed bid and lock escrow.
    ///
    /// - `commitment` H binds the bid; checked at reveal.
    /// - `ciphertext` C is the timelock seal; guarantees forced reveal.
    /// - `escrow` is a public USDC budget and an upper bound on the sealed bid;
    ///   locked now so the winner can always pay.
    /// - `auditor_blob` is the bidder identity encrypted to the auditor key.
    /// - `seal_round` must equal the round's stored `reveal_round`: the seal is
    ///   only meaningful for the Drand round this auction committed to open.
    ///   Mismatched seals are rejected before any escrow is locked.
    pub fn commit(
        env: Env,
        round_id: u64,
        bidder: Address,
        commitment: BytesN<32>,
        ciphertext: Bytes,
        escrow: i128,
        auditor_blob: Bytes,
        seal_round: u64,
    ) -> Result<(), Error> {
        bidder.require_auth();
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;

        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() > round.commit_deadline {
            return Err(Error::CommitClosed);
        }
        if escrow <= 0 {
            return Err(Error::InvalidAmount);
        }
        if ciphertext.len() > MAX_CIPHERTEXT || auditor_blob.len() > MAX_AUDITOR_BLOB {
            return Err(Error::PayloadTooLarge);
        }
        // The allowed reveal round is the one stored on the auction, not a
        // caller-supplied value. Rejecting here — before the escrow transfer —
        // means a seal for a different Drand round can never lock funds and the
        // bidder keeps their full error budget for honest resubmission.
        drand::validate_seal_round(&round, seal_round)?;

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        // Capacity first: a full round is rejected before any escrow accounting
        // runs, so the bidder cap keeps its own error regardless of round state.
        let prev = try_get_state(&env, round_id, &bidder);
        if prev.is_none() && round.bidders.len() >= MAX_BIDDERS {
            return Err(Error::RoundFull);
        }

        // Escrow conservation: this is the only path that brings escrow in, so
        // the round's ledger is extended here, alongside the transfer itself.
        let mut ledger = ensure_ledger(&env, round_id, &round)?;

        // Overwrite-before-close: refund the prior escrow, then re-lock the new
        // amount. This keeps "one effective bid per bidder" while allowing edits.
        match prev {
            Some(prev) => {
                if prev.escrow > 0 {
                    usdc.transfer(&contract, &bidder, &prev.escrow);
                    ledger.refund(prev.escrow);
                }
            }
            None => round.bidders.push_back(bidder.clone()),
        }

        usdc.transfer(&bidder, &contract, &escrow);
        ledger.deposit(escrow);
        set_ledger(&env, round_id, &ledger);

        let state = BidState {
            commitment,
            escrow,
            revealed_value: None,
            revealed_nonce: None,
            valid: false,
            settled: false,
        };
        set_state(&env, round_id, &bidder, &state);
        set_seal(
            &env,
            round_id,
            &bidder,
            &Seal {
                ciphertext,
                auditor_blob,
            },
            round.reveal_deadline,
        );
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("commit"), round_id), (bidder, escrow));
        Ok(())
    }

    /// Open the reveal window by proving Drand round R has been produced.
    ///
    /// The supplied signature is verified on-chain via BLS12-381. This is the
    /// only way to move a round into `Revealing`; there is no operator override.
    pub fn open_reveal(
        env: Env,
        round_id: u64,
        drand_signature: BytesN<96>,
    ) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;

        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status != Status::Open {
            return Err(Error::RevealAlreadyOpen);
        }
        if env.ledger().timestamp() <= round.commit_deadline {
            return Err(Error::CommitNotClosed);
        }
        if !drand::verify_round(&env, &config, round.reveal_round, &drand_signature) {
            return Err(Error::InvalidDrandSignature);
        }

        round.status = Status::Revealing;
        extend_round_seals(&env, round_id, &round.bidders, round.reveal_deadline);
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("revealing"), round_id), round.reveal_round);
        Ok(())
    }

    /// Reveal a bid. Permissionless: once R's signature is public, anyone can
    /// decrypt any ciphertext and submit the reveal — so no bidder can abort.
    /// The contract checks `sha256(be16(value) ‖ nonce) == H`.
    pub fn reveal(
        env: Env,
        round_id: u64,
        bidder: Address,
        value: i128,
        nonce: BytesN<32>,
    ) -> Result<(), Error> {
        let round = get_round(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() > round.reveal_deadline {
            return Err(Error::RevealWindowClosed);
        }

        let mut state = get_state(&env, round_id, &bidder)?;
        if state.revealed_value.is_some() {
            return Err(Error::AlreadyRevealed);
        }

        // A reveal moves no escrow, but it must never be recorded against a
        // round the contract can no longer account for — including a round
        // whose bidder index drifted from the set that was escrowed.
        let ledger = ensure_ledger(&env, round_id, &round)?;
        prove_conserved(&env, round_id, &round, &ledger)?;

        let mut preimage = Bytes::new(&env);
        preimage.extend_from_array(&value.to_be_bytes());
        preimage.extend_from_array(&nonce.to_array());
        let computed = env.crypto().sha256(&preimage).to_bytes();

        // A reveal MUST match the commitment, or it is rejected outright with no
        // state change. Reveal is permissionless, so without this a third party
        // could grief an honest bidder by front-running their reveal with a
        // garbage value — locking them out (AlreadyRevealed) and invalidating
        // their bid. Since the canonical value is recoverable by anyone from the
        // ciphertext after R, only the value that hashes to H is ever recorded.
        if computed != state.commitment {
            return Err(Error::HashMismatch);
        }

        // The committed value is canonical, but a reveal above escrow is rejected
        // outright so integrators see BidExceedsEscrow instead of a silent invalid bid.
        if value > state.escrow {
            return Err(Error::BidExceedsEscrow);
        }

        state.revealed_value = Some(value);
        state.revealed_nonce = Some(nonce.clone());
        state.valid = value > 0;
        set_state(&env, round_id, &bidder, &state);

        env.events().publish(
            (symbol_short!("reveal"), round_id),
            (bidder, value, state.valid),
        );
        Ok(())
    }

    /// Deterministically compute the winner after the reveal deadline. If no
    /// valid bid was revealed, the round is voided and all escrow becomes
    /// refundable.
    pub fn clear(env: Env, round_id: u64) -> Result<Option<Address>, Error> {
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() <= round.reveal_deadline {
            return Err(Error::RevealStillOpen);
        }

        let mut winner: Option<Address> = None;
        let mut best: i128 = 0;
        let mut found = false;

        for bidder in round.bidders.iter() {
            let state = match try_get_state(&env, round_id, &bidder) {
                Some(s) => s,
                None => continue,
            };
            if !state.valid {
                continue;
            }
            let value = match state.revealed_value {
                Some(v) => v,
                None => continue,
            };
            let better = if !found {
                true
            } else {
                match round.clearing_rule {
                    ClearingRule::HighestBid => value > best,
                    ClearingRule::LowestBid => value < best,
                }
            };
            if better {
                best = value;
                winner = Some(bidder.clone());
                found = true;
            }
        }

        if !found {
            round.status = Status::Voided;
            set_round(&env, round_id, &round);
            refund_all(&env, round_id, &round)?;
            env.events().publish((symbol_short!("voided"), round_id), 0u32);
            return Ok(None);
        }

        round.winner = winner.clone();
        round.winning_bid = best;
        round.status = Status::Cleared;
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("cleared"), round_id), (winner.clone(), best));
        Ok(winner)
    }

    /// Settle a cleared round. The winner pays their bid from escrow to the
    /// operator; the winner's surplus and every loser's escrow are refunded.
    /// Cannot fail for lack of funds — everything was escrowed at commit.
    ///
    /// Escrow conservation is proved before and after the transfers: the round's
    /// ledger must satisfy `conserved` against the escrow its bidder index still
    /// holds, the payout plus planned refunds must drain exactly the locked
    /// balance, and nothing may stay locked once the round is terminal. A settle
    /// that would mint, drop, or double-pay escrow is rejected instead of
    /// executed, and any rejection reverts every transfer with it.
    pub fn settle(env: Env, round_id: u64) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Cleared {
            return Err(Error::NotCleared);
        }
        let winner = round.winner.clone().ok_or(Error::NoValidBids)?;

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        // Escrow conservation: the ledger records every token that enters or
        // leaves the contract for this round, so the predicate in `prove_conserved`
        // can be checked before settlement instead of inferred from balances.
        let mut ledger = ensure_ledger(&env, round_id, &round)?;
        let index = prove_conserved(&env, round_id, &round, &ledger)?;

        // Plan first: prove the payout plus every planned refund drains exactly
        // the locked balance. Overpaying the operator (mint) or leaving a bid
        // unreimbursed (drop) both fail here, before any transfer runs.
        let mut refund_total = 0i128;
        for bidder in round.bidders.iter() {
            let state = try_get_state(&env, round_id, &bidder).ok_or(Error::EscrowNotConserved)?;
            if state.settled {
                continue;
            }
            if bidder == winner {
                if round.winning_bid > state.escrow {
                    return Err(Error::EscrowNotConserved);
                }
                refund_total += state.escrow - round.winning_bid;
            } else {
                refund_total += state.escrow;
            }
        }
        if round.winning_bid + refund_total != index.locked || index.settled != 0 {
            return Err(Error::EscrowNotConserved);
        }

        for bidder in round.bidders.iter() {
            let mut state =
                try_get_state(&env, round_id, &bidder).ok_or(Error::EscrowNotConserved)?;
            if state.settled {
                continue;
            }
            if bidder == winner {
                usdc.transfer(&contract, &round.operator, &round.winning_bid);
                ledger.pay_operator(round.winning_bid);
                let surplus = state.escrow - round.winning_bid;
                if surplus > 0 {
                    usdc.transfer(&contract, &bidder, &surplus);
                    ledger.refund(surplus);
                }
            } else if state.escrow > 0 {
                usdc.transfer(&contract, &bidder, &state.escrow);
                ledger.refund(state.escrow);
            }
            state.settled = true;
            set_state(&env, round_id, &bidder, &state);
        }
        set_ledger(&env, round_id, &ledger);
        // Terminal state: nothing may stay locked. A residual balance means an
        // escrow-bearing bid was not paid, so the call reverts with every
        // transfer above rolled back.
        if !conserved(
            ledger.committed,
            ledger.payout,
            ledger.refunds,
            ledger.locked,
        ) || ledger.locked != 0
        {
            return Err(Error::EscrowNotConserved);
        }

        round.status = Status::Settled;
        set_round(&env, round_id, &round);

        env.events().publish(
            (symbol_short!("settled"), round_id),
            (winner, round.winning_bid),
        );
        Ok(())
    }

    /// Liveness safety valve: if Drand round R is never produced (network stall)
    /// and the grace window after the reveal deadline has passed without the
    /// round opening, anyone can void it and all escrow is refunded.
    pub fn void(env: Env, round_id: u64) -> Result<(), Error> {
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open {
            return Err(Error::NotVoidable);
        }
        if env.ledger().timestamp() <= round.reveal_deadline + VOID_GRACE {
            return Err(Error::NotVoidable);
        }

        round.status = Status::Voided;
        set_round(&env, round_id, &round);
        refund_all(&env, round_id, &round)?;

        env.events().publish((symbol_short!("voided"), round_id), 1u32);
        Ok(())
    }

    // ---- Views ----

    pub fn get_round(env: Env, round_id: u64) -> Result<Round, Error> {
        storage::get_round(&env, round_id)
    }

    pub fn get_bid_state(env: Env, round_id: u64, bidder: Address) -> Result<BidState, Error> {
        storage::get_state(&env, round_id, &bidder)
    }

    /// Keeper view: the deterministic, ordered bidder index for a round. The
    /// keeper reads this to learn exactly which seals must be opened and
    /// revealed — the reveal set is on-chain state, so no event scraping or
    /// indexer is required and nothing can be missed.
    pub fn get_bidders(env: Env, round_id: u64) -> Result<Vec<Address>, Error> {
        Ok(storage::get_round(&env, round_id)?.bidders)
    }

    /// Paginated bidder index. Pass None to start, then the opaque next_cursor.
    /// The snapshot count is fixed on the first page; appended bidders require
    /// a new enumeration. Limit must be 1–100. has_more is false at exhaustion.
    pub fn get_bidders_page(
        env: Env,
        round_id: u64,
        cursor: Option<Bytes>,
        limit: u32,
    ) -> Result<BiddersPage, Error> {
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(Error::InvalidLimit);
        }
        storage::bidders_page(&env, round_id, cursor, limit)
    }

    /// Observer view: the sealed ciphertext + auditor blob while still in
    /// Temporary storage. Returns `None` once the seal TTL has expired (by design
    /// after the reveal window). Persistent bid state remains for settlement.
    pub fn get_seal(env: Env, round_id: u64, bidder: Address) -> Option<Seal> {
        let round = storage::get_round(&env, round_id).ok()?;
        storage::get_seal(&env, round_id, &bidder, round.reveal_deadline)
    }

    pub fn get_config(env: Env) -> Result<GlobalConfig, Error> {
        storage::get_config(&env)
    }
}

/// Single-pass view of the escrow still owed by the round's bidder index.
///
/// `locked` is the escrow held for indexed bids that have not been settled yet.
/// It is the contract's own answer to "how much of the round's escrow is still
/// locked", derived from durable bid state rather than from the ledger, so the
/// two can be compared against each other.
struct EscrowIndex {
    locked: i128,
    settled: u32,
}

/// Walk the round's bidder index once, reading each indexed bid's durable state.
///
/// A bidder listed in the index with no durable bid state makes the round
/// unaccountable for, so the whole round is rejected: the alternative is paying
/// from a set that cannot be reconciled with the set that was escrowed.
fn scan_bidder_index(env: &Env, round_id: u64, round: &Round) -> Result<EscrowIndex, Error> {
    let mut index = EscrowIndex {
        locked: 0,
        settled: 0,
    };
    for bidder in round.bidders.iter() {
        let state = try_get_state(env, round_id, &bidder).ok_or(Error::EscrowNotConserved)?;
        if state.settled {
            index.settled += 1;
        } else {
            index.locked += state.escrow;
        }
    }
    Ok(index)
}

/// The one conservation predicate for a round: committed escrow equals the
/// settled payout plus refunds plus the balance still locked.
///
/// This is the invariant every path in this contract proves before and after it
/// moves escrow. `locked` is an independently accumulated field rather than the
/// residual of the other three, so an arithmetic slip in a transfer path cannot
/// silently cancel out.
fn conserved(committed: i128, payout: i128, refunds: i128, locked: i128) -> bool {
    committed >= 0
        && payout >= 0
        && refunds >= 0
        && locked >= 0
        && committed == payout + refunds + locked
}

/// Escrow accounting primitives. Each one must be called in lockstep with the
/// token transfer it describes, which is what keeps `locked` equal to the escrow
/// the bidder index still holds.
impl EscrowLedger {
    /// Escrow received from a bidder (`commit`).
    fn deposit(&mut self, amount: i128) {
        self.committed += amount;
        self.locked += amount;
    }

    /// Escrow returned to a bidder: an overwrite refund, the winner's surplus,
    /// a loser's refund, or a void refund.
    fn refund(&mut self, amount: i128) {
        self.refunds += amount;
        self.locked -= amount;
    }

    /// The settled bid paid to the round operator (`settle`).
    fn pay_operator(&mut self, amount: i128) {
        self.payout += amount;
        self.locked -= amount;
    }
}

/// Prove the round's escrow is conserved, or reject the call.
///
/// Two things must hold. The ledger's cumulative flows must satisfy
/// [`conserved`], and the escrow the ledger says is locked must be matched by
/// the escrow that indexed, unsettled bids actually hold. The second check is
/// what rejects a bidder index that drifted from the escrowed set — a dropped,
/// duplicated, or phantom bidder — which would otherwise mint, drop, or
/// double-pay escrow on a partial reveal, void, or settle.
/// The conservation predicate for one round, as observed at a single point in
/// time: the ledger's cumulative flows, the balance it says is still locked,
/// and whether that balance is backed by unsettled indexed bids.
struct ConservationReport {
    conserved: bool,
}

fn prove_conserved(
    env: &Env,
    round_id: u64,
    round: &Round,
    ledger: &EscrowLedger,
) -> Result<EscrowIndex, Error> {
    let index = scan_bidder_index(env, round_id, round)?;
    let report = ConservationReport {
        conserved: conserved(
            ledger.committed,
            ledger.payout,
            ledger.refunds,
            ledger.locked,
        ) && index.locked == ledger.locked,
    };
    if !report.conserved {
        return Err(Error::EscrowNotConserved);
    }
    Ok(index)
}

/// The round's escrow ledger, seeded from live bid state the first time it is
/// needed so a round that was escrowed before this ledger existed still settles.
/// Seeding is exact: every escrow currently attributed to the index becomes both
/// committed and locked, with nothing paid out yet.
fn ensure_ledger(env: &Env, round_id: u64, round: &Round) -> Result<EscrowLedger, Error> {
    if let Some(ledger) = try_get_ledger(env, round_id) {
        return Ok(ledger);
    }
    let index = scan_bidder_index(env, round_id, round)?;
    let ledger = EscrowLedger {
        committed: index.locked,
        payout: 0,
        refunds: 0,
        locked: index.locked,
    };
    set_ledger(env, round_id, &ledger);
    Ok(ledger)
}

/// Refund every locked escrow for a voided round, exactly once per bidder.
///
/// A void pays nobody, so the whole locked balance must be returned to bidders.
/// The refund plan is proved against the bidder index before any transfer, and
/// the resulting ledger must satisfy the predicate with nothing left locked; a
/// bidder that cannot be refunded fails the call with every transfer rolled
/// back rather than leaving escrow stranded in the contract.
fn refund_all(env: &Env, round_id: u64, round: &Round) -> Result<(), Error> {
    let config = get_config(env)?;
    let usdc = token::Client::new(env, &config.usdc);
    let contract = env.current_contract_address();

    let mut ledger = ensure_ledger(env, round_id, round)?;
    let index = prove_conserved(env, round_id, round, &ledger)?;
    // A void pays nobody, and nothing may already have been paid out: every
    // locked dollar has to still be sitting on an unsettled indexed bid.
    if ledger.payout != 0 || index.settled != 0 {
        return Err(Error::EscrowNotConserved);
    }

    for bidder in round.bidders.iter() {
        let mut state = try_get_state(env, round_id, &bidder).ok_or(Error::EscrowNotConserved)?;
        if state.settled || state.escrow <= 0 {
            continue;
        }
        usdc.transfer(&contract, &bidder, &state.escrow);
        ledger.refund(state.escrow);
        state.settled = true;
        set_state(env, round_id, &bidder, &state);
    }
    set_ledger(env, round_id, &ledger);

    if !conserved(
        ledger.committed,
        ledger.payout,
        ledger.refunds,
        ledger.locked,
    ) || ledger.locked != 0
    {
        return Err(Error::EscrowNotConserved);
    }
    Ok(())
}

fn panic_with(env: &Env, error: Error) -> ! {
    soroban_sdk::panic_with_error!(env, error)
}

#[cfg(test)]
mod test;
