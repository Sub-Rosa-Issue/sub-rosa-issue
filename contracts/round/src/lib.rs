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
    ) -> Result<u64, Error> {
        operator.require_auth();
        let config = get_config(&env)?;
        bump_instance(&env);

        if reveal_round == 0 {
            return Err(Error::InvalidAmount);
        }
        if auditor_pubkey.len() > MAX_AUDITOR_PUBKEY {
            return Err(Error::PayloadTooLarge);
        }

        let now = env.ledger().timestamp();
        let t_reveal = drand::time_of_round(&config, reveal_round);

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
    pub fn commit(
        env: Env,
        round_id: u64,
        bidder: Address,
        commitment: BytesN<32>,
        ciphertext: Bytes,
        escrow: i128,
        auditor_blob: Bytes,
    ) -> Result<(), Error> {
        bidder.require_auth();
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;

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

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        // Overwrite-before-close: refund the prior escrow, then re-lock the new
        // amount. This keeps "one effective bid per bidder" while allowing edits.
        match try_get_state(&env, round_id, &bidder) {
            Some(prev) => {
                if prev.escrow > 0 {
                    usdc.transfer(&contract, &bidder, &prev.escrow);
                }
            }
            None => {
                if round.bidders.len() >= MAX_BIDDERS {
                    return Err(Error::RoundFull);
                }
                round.bidders.push_back(bidder.clone());
            }
        }

        usdc.transfer(&bidder, &contract, &escrow);

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

        // The committed value is canonical, but it is still excluded from
        // clearing if the bidder committed to a non-positive value or one above
        // their escrow (a self-inflicted invalid bid; escrow refunded at settle).
        state.revealed_value = Some(value);
        state.revealed_nonce = Some(nonce.clone());
        state.valid = value > 0 && value <= state.escrow;
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
            refund_all(&env, &round, round_id);
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
    pub fn settle(env: Env, round_id: u64) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;
        if round.status != Status::Cleared {
            return Err(Error::NotCleared);
        }
        let winner = round.winner.clone().ok_or(Error::NoValidBids)?;

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        for bidder in round.bidders.iter() {
            let mut state = match try_get_state(&env, round_id, &bidder) {
                Some(s) => s,
                None => continue,
            };
            if state.settled {
                continue;
            }
            if bidder == winner {
                usdc.transfer(&contract, &round.operator, &round.winning_bid);
                let surplus = state.escrow - round.winning_bid;
                if surplus > 0 {
                    usdc.transfer(&contract, &bidder, &surplus);
                }
            } else if state.escrow > 0 {
                usdc.transfer(&contract, &bidder, &state.escrow);
            }
            state.settled = true;
            set_state(&env, round_id, &bidder, &state);
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
        if round.status != Status::Open {
            return Err(Error::NotVoidable);
        }
        if env.ledger().timestamp() <= round.reveal_deadline + VOID_GRACE {
            return Err(Error::NotVoidable);
        }

        round.status = Status::Voided;
        set_round(&env, round_id, &round);
        refund_all(&env, &round, round_id);

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

    /// Paginated bidder index for a round. Returns a page of bidders starting
    /// at `cursor` (zero-based), with continuation metadata.
    ///
    /// `limit` must be 1–100. `next_cursor` in the response is 0 when there
    /// are no more pages.
    pub fn get_bidders_page(
        env: Env,
        round_id: u64,
        cursor: u32,
        limit: u32,
    ) -> Result<BiddersPage, Error> {
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(Error::InvalidLimit);
        }
        let bidders = storage::get_round(&env, round_id)?.bidders;
        let total = bidders.len();
        let start = cursor.min(total);
        let end = (start + limit).min(total);
        let mut data: Vec<Address> = Vec::new(&env);
        for i in start..end {
            data.push_back(bidders.get(i).unwrap());
        }
        let next_cursor = if end < total { end } else { 0 };
        Ok(BiddersPage {
            data,
            next_cursor,
            total,
        })
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

/// Refund every locked escrow for a voided round.
fn refund_all(env: &Env, round: &Round, round_id: u64) {
    let config = match storage::get_config(env) {
        Ok(c) => c,
        Err(_) => return,
    };
    let usdc = token::Client::new(env, &config.usdc);
    let contract = env.current_contract_address();
    for bidder in round.bidders.iter() {
        if let Some(mut state) = try_get_state(env, round_id, &bidder) {
            if !state.settled && state.escrow > 0 {
                usdc.transfer(&contract, &bidder, &state.escrow);
                state.settled = true;
                set_state(env, round_id, &bidder, &state);
            }
        }
    }
}

fn panic_with(env: &Env, error: Error) -> ! {
    soroban_sdk::panic_with_error!(env, error)
}

#[cfg(test)]
mod test;
