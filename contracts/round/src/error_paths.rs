//! Integration tests that exercise every custom contract error code.
//!
//! Reserved enum variants (documented in ERRORS.md but not returned by current
//! code paths) are covered by the drift registry instead of runtime triggers.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env,
};

use crate::storage::{get_round, set_round};
use crate::types::{ClearingRule, DataKey, Error, Status};

use super::{
    assert_try_create_round_err, assert_try_contract_err, b32, commit_bid, drand_round,
    funded_bidder, open_round, real_sig, setup, setup_drand, Fixture, VEC_ROUND,
};

const MAX_BIDDERS: u32 = 500;

/// Every variant must appear here exactly once. Reserved entries use
/// `trigger: None`; exercised paths name their test function.
const ERROR_PATH_REGISTRY: &[(Error, Option<&'static str>)] = &[
    (Error::NotInitialized, Some("error_path_not_initialized")),
    (Error::AlreadyInitialized, None),
    (Error::RoundNotFound, Some("error_path_round_not_found")),
    (Error::BidNotFound, Some("error_path_bid_not_found")),
    (Error::CommitClosed, Some("error_path_commit_closed")),
    (Error::CommitNotClosed, Some("error_path_commit_not_closed")),
    (Error::CommitDeadlineAfterReveal, Some("error_path_commit_deadline_after_reveal")),
    (Error::RevealNotOpen, Some("error_path_reveal_not_open")),
    (Error::RevealAlreadyOpen, Some("error_path_reveal_already_open")),
    (Error::RevealWindowClosed, Some("error_path_reveal_window_closed")),
    (Error::RevealStillOpen, Some("error_path_reveal_still_open")),
    (Error::NotCleared, Some("error_path_not_cleared")),
    (Error::AlreadyCleared, None),
    (Error::AlreadySettled, None),
    (Error::RoundVoided, None),
    (Error::NotVoidable, Some("error_path_not_voidable")),
    (Error::WrongStatus, Some("error_path_wrong_status")),
    (Error::InvalidDrandSignature, Some("error_path_invalid_drand_signature")),
    (Error::HashMismatch, Some("error_path_hash_mismatch")),
    (Error::AlreadyRevealed, Some("error_path_already_revealed")),
    (Error::PayloadTooLarge, Some("error_path_payload_too_large")),
    (Error::InvalidAmount, Some("error_path_invalid_amount")),
    (Error::BidExceedsEscrow, None),
    (Error::DeadlineInPast, Some("error_path_deadline_in_past")),
    (Error::NoValidBids, Some("error_path_no_valid_bids")),
    (Error::RoundFull, Some("error_path_round_full")),
    (Error::InvalidLimit, Some("error_path_invalid_limit")),
];

fn oversized_bytes(env: &Env, len: u32) -> Bytes {
    let mut buf = [0u8; 1025];
    buf.fill(b'x');
    Bytes::from_slice(env, &buf[..len as usize])
}

fn fill_bidder_cap(f: &Fixture, round_id: u64) {
    f.env.as_contract(&f.client.address, || {
        let mut round = get_round(&f.env, round_id).unwrap();
        while round.bidders.len() < MAX_BIDDERS {
            round.bidders.push_back(Address::generate(&f.env));
        }
        set_round(&f.env, round_id, &round);
    });
}

#[test]
fn error_paths_registry_covers_every_variant() {
    assert_eq!(
        ERROR_PATH_REGISTRY.len(),
        27,
        "update ERROR_PATH_REGISTRY when adding/removing Error variants"
    );
}

#[test]
fn error_paths_registry_matches_documented_codes() {
    for (variant, _) in ERROR_PATH_REGISTRY {
        let documented = super::DOCUMENTED_ERROR_CODES
            .iter()
            .find(|(v, _)| *v == *variant)
            .map(|(_, code)| *code)
            .unwrap_or_else(|| panic!("{variant:?} missing from DOCUMENTED_ERROR_CODES"));
        assert_eq!(
            super::discriminant(*variant),
            documented,
            "{} discriminant drift",
            super::variant_name(*variant)
        );
    }
}

#[test]
fn error_paths_without_runtime_trigger_are_documented() {
    let documented_only = [
        Error::AlreadyInitialized,
        Error::AlreadyCleared,
        Error::AlreadySettled,
        Error::RoundVoided,
        Error::BidExceedsEscrow,
    ];
    for variant in documented_only {
        let entry = ERROR_PATH_REGISTRY
            .iter()
            .find(|(v, _)| *v == variant)
            .unwrap_or_else(|| panic!("{variant:?} missing from registry"));
        assert!(
            entry.1.is_none(),
            "{} should be documented-only (no current return path or deploy-only)",
            super::variant_name(variant),
        );
    }
}

#[test]
fn error_path_not_initialized() {
    let f = setup();
    f.env.as_contract(&f.client.address, || {
        f.env.storage().instance().remove(&DataKey::Config);
    });
    assert_try_contract_err(f.client.try_get_config(), Error::NotInitialized);
}

#[test]
fn error_path_invalid_drand_signature() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = f.client.create_round(
        &operator,
        &b32(&f.env, 0xAB),
        &(VEC_ROUND + 1),
        &ClearingRule::HighestBid,
        &commit_deadline,
        &reveal_deadline,
        &Bytes::from_array(&f.env, b"auditor"),
    );
    let bidder = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &bidder, 100, 100, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    assert_try_contract_err(
        f.client.try_open_reveal(&id, &real_sig(&f.env)),
        Error::InvalidDrandSignature,
    );
}

#[test]
fn error_path_round_not_found() {
    let f = setup();
    assert_try_contract_err(f.client.try_get_round(&9_999), Error::RoundNotFound);
}

#[test]
fn error_path_bid_not_found() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let stranger = Address::generate(&f.env);
    assert_try_contract_err(
        f.client.try_get_bid_state(&id, &stranger),
        Error::BidNotFound,
    );
}

#[test]
fn error_path_commit_closed() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.env.ledger().with_mut(|l| l.timestamp = 1_600);
    assert_try_contract_err(
        f.client.try_commit(
            &id,
            &bidder,
            &b32(&f.env, 7),
            &Bytes::from_array(&f.env, b"c"),
            &600,
            &Bytes::from_array(&f.env, b"id"),
        ),
        Error::CommitClosed,
    );
}

#[test]
fn error_path_commit_not_closed() {
    let (f, _t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    assert_try_contract_err(
        f.client.try_open_reveal(&id, &real_sig(&f.env)),
        Error::CommitNotClosed,
    );
}

#[test]
fn error_path_commit_deadline_after_reveal() {
    let f = setup();
    let operator = Address::generate(&f.env);
    assert_try_create_round_err(
        f.client.try_create_round(
            &operator,
            &b32(&f.env, 1),
            &2_000,
            &ClearingRule::HighestBid,
            &2_000,
            &2_500,
            &Bytes::from_array(&f.env, b"a"),
        ),
        Error::CommitDeadlineAfterReveal,
    );
}

#[test]
fn error_path_reveal_not_open() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    let nonce = commit_bid(&f, id, &bidder, 500, 500, 0x01);
    assert_try_contract_err(
        f.client.try_reveal(&id, &bidder, &500, &nonce),
        Error::RevealNotOpen,
    );
}

#[test]
fn error_path_reveal_already_open() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);
    assert_try_contract_err(
        f.client.try_open_reveal(&id, &real_sig(&f.env)),
        Error::RevealAlreadyOpen,
    );
}

#[test]
fn error_path_reveal_window_closed() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_try_contract_err(
        f.client.try_reveal(&id, &alice, &500, &a_nonce),
        Error::RevealWindowClosed,
    );
}

#[test]
fn error_path_reveal_still_open() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert_try_contract_err(f.client.try_clear(&id), Error::RevealStillOpen);
    let _ = reveal_deadline;
}

#[test]
fn error_path_not_cleared() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_try_contract_err(f.client.try_settle(&id), Error::NotCleared);
}

#[test]
fn error_path_not_voidable() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    f.env.ledger().with_mut(|l| l.timestamp = 2_600);
    assert_try_contract_err(f.client.try_void(&id), Error::NotVoidable);
}

#[test]
fn error_path_wrong_status() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);
    let late = funded_bidder(&f, 1_000);
    assert_try_contract_err(
        f.client.try_commit(
            &id,
            &late,
            &b32(&f.env, 0x77),
            &Bytes::from_array(&f.env, b"c"),
            &100,
            &Bytes::from_array(&f.env, b"id"),
        ),
        Error::WrongStatus,
    );
}

#[test]
fn error_path_hash_mismatch() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert_try_contract_err(
        f.client.try_reveal(&id, &alice, &999, &b32(&f.env, 0x01)),
        Error::HashMismatch,
    );
}

#[test]
fn error_path_already_revealed() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    assert_try_contract_err(
        f.client.try_reveal(&id, &alice, &500, &a_nonce),
        Error::AlreadyRevealed,
    );
}

#[test]
fn error_path_payload_too_large() {
    let f = setup();
    let operator = Address::generate(&f.env);
    assert_try_create_round_err(
        f.client.try_create_round(
            &operator,
            &b32(&f.env, 1),
            &2_000,
            &ClearingRule::HighestBid,
            &1_500,
            &2_500,
            &oversized_bytes(&f.env, 1025),
        ),
        Error::PayloadTooLarge,
    );
}

#[test]
fn error_path_invalid_amount() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    assert_try_contract_err(
        f.client.try_commit(
            &id,
            &bidder,
            &b32(&f.env, 7),
            &Bytes::from_array(&f.env, b"c"),
            &0,
            &Bytes::from_array(&f.env, b"id"),
        ),
        Error::InvalidAmount,
    );
}

#[test]
fn error_path_deadline_in_past() {
    let f = setup();
    let operator = Address::generate(&f.env);
    assert_try_create_round_err(
        f.client.try_create_round(
            &operator,
            &b32(&f.env, 1),
            &2_000,
            &ClearingRule::HighestBid,
            &500,
            &2_500,
            &Bytes::from_array(&f.env, b"a"),
        ),
        Error::DeadlineInPast,
    );
}

#[test]
fn error_path_no_valid_bids() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    f.env.as_contract(&f.client.address, || {
        let mut round = get_round(&f.env, id).unwrap();
        round.status = Status::Cleared;
        round.winner = None;
        set_round(&f.env, id, &round);
    });
    assert_try_contract_err(f.client.try_settle(&id), Error::NoValidBids);
}

#[test]
fn error_path_round_full() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    fill_bidder_cap(&f, id);
    let late = funded_bidder(&f, 1_000);
    assert_try_contract_err(
        f.client.try_commit(
            &id,
            &late,
            &b32(&f.env, 0x77),
            &Bytes::from_array(&f.env, b"c"),
            &100,
            &Bytes::from_array(&f.env, b"id"),
        ),
        Error::RoundFull,
    );
}

#[test]
fn error_path_invalid_limit() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert_try_contract_err(f.client.try_get_bidders_page(&id, &0, &0), Error::InvalidLimit);
    assert_try_contract_err(f.client.try_get_bidders_page(&id, &0, &101), Error::InvalidLimit);
}
