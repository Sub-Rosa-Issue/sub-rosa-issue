use soroban_sdk::{Address, Env, Vec};

use crate::types::{BidState, DataKey, Error, GlobalConfig, Round, Seal};

// TTL policy. Ledger close time on Stellar is ~5s, so these are generous for a
// hackathon-scale round while keeping ephemeral seal data short-lived.
const LEDGERS_PER_DAY: u32 = 17_280;
const LEDGER_CLOSE_SECS: u64 = 5;
/// Keep seals readable briefly after the reveal window for observer polling.
const POST_REVEAL_SEAL_BUFFER_SECS: u64 = 86_400;
pub const PERSISTENT_BUMP: u32 = 60 * LEDGERS_PER_DAY;
pub const PERSISTENT_THRESHOLD: u32 = 50 * LEDGERS_PER_DAY;
pub const TEMP_THRESHOLD: u32 = 2 * LEDGERS_PER_DAY;

/// Ledgers from the current ledger until seals should remain readable for a round.
pub fn seal_ttl_for_reveal_deadline(reveal_deadline: u64, now: u64) -> u32 {
    let secs = reveal_deadline
        .saturating_sub(now)
        .saturating_add(POST_REVEAL_SEAL_BUFFER_SECS);
    let ledgers = (secs / LEDGER_CLOSE_SECS).max(u64::from(TEMP_THRESHOLD)) as u32;
    ledgers.min(PERSISTENT_BUMP)
}

fn extend_seal_ttl(env: &Env, key: &DataKey, reveal_deadline: u64) {
    let bump = seal_ttl_for_reveal_deadline(reveal_deadline, env.ledger().timestamp());
    let threshold = bump.saturating_sub(LEDGERS_PER_DAY);
    env.storage()
        .temporary()
        .extend_ttl(key, threshold, bump);
}

pub fn get_config(env: &Env) -> Result<GlobalConfig, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

pub fn set_config(env: &Env, config: &GlobalConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn next_round_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::RoundCounter)
        .unwrap_or(0);
    let next = id + 1;
    env.storage().instance().set(&DataKey::RoundCounter, &next);
    next
}

pub fn get_round(env: &Env, round_id: u64) -> Result<Round, Error> {
    let key = DataKey::Round(round_id);
    let round: Round = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::RoundNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    Ok(round)
}

pub fn set_round(env: &Env, round_id: u64, round: &Round) {
    let key = DataKey::Round(round_id);
    env.storage().persistent().set(&key, round);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_state(env: &Env, round_id: u64, bidder: &Address) -> Result<BidState, Error> {
    let key = DataKey::State(round_id, bidder.clone());
    let state: BidState = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::BidNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    Ok(state)
}

pub fn try_get_state(env: &Env, round_id: u64, bidder: &Address) -> Option<BidState> {
    env.storage()
        .persistent()
        .get(&DataKey::State(round_id, bidder.clone()))
}

pub fn set_state(env: &Env, round_id: u64, bidder: &Address, state: &BidState) {
    let key = DataKey::State(round_id, bidder.clone());
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn set_seal(env: &Env, round_id: u64, bidder: &Address, seal: &Seal, reveal_deadline: u64) {
    let key = DataKey::Seal(round_id, bidder.clone());
    env.storage().temporary().set(&key, seal);
    extend_seal_ttl(env, &key, reveal_deadline);
}

pub fn get_seal(env: &Env, round_id: u64, bidder: &Address, reveal_deadline: u64) -> Option<Seal> {
    let key = DataKey::Seal(round_id, bidder.clone());
    let seal = env.storage().temporary().get(&key)?;
    extend_seal_ttl(env, &key, reveal_deadline);
    Some(seal)
}

/// Re-extend every committed seal through the reveal window when reveal opens.
pub fn extend_round_seals(env: &Env, round_id: u64, bidders: &Vec<Address>, reveal_deadline: u64) {
    for bidder in bidders.iter() {
        let key = DataKey::Seal(round_id, bidder.clone());
        if env.storage().temporary().has(&key) {
            extend_seal_ttl(env, &key, reveal_deadline);
        }
    }
}
