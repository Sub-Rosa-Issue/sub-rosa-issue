//! Integration tests that exercise every custom contract error code.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, Env, IntoVal, Symbol,
};

use crate::storage::{get_round, set_round};
use crate::types::{ClearingRule, DataKey, Error, Status};

use super::{
    assert_try_create_round_err, assert_try_contract_err, b32, commit_bid, commitment,
    drand_round, funded_bidder, open_round, real_sig, setup, setup_drand, Fixture, GENESIS,
    PERIOD, VEC_ROUND,
};

const MAX_BIDDERS: u32 = 500;

/// Every variant must appear here exactly once with the test that triggers it.
const ERROR_PATH_REGISTRY: &[(Error, &'static str)] = &[
    (Error::NotInitialized, "error_path_not_initialized"),
    (Error::AlreadyInitialized, "error_path_already_initialized_constructor_boundary"),
    (Error::RoundNotFound, "error_path_round_not_found"),
    (Error::BidNotFound, "error_path_bid_not_found"),
    (Error::CommitClosed, "error_path_commit_closed"),
    (Error::CommitNotClosed, "error_path_commit_not_closed"),
    (Error::CommitDeadlineAfterReveal, "error_path_commit_deadline_after_reveal"),
    (Error::RevealNotOpen, "error_path_reveal_not_open"),
    (Error::RevealAlreadyOpen, "error_path_reveal_already_open"),
    (Error::RevealWindowClosed, "error_path_reveal_window_closed"),
    (Error::RevealStillOpen, "error_path_reveal_still_open"),
    (Error::NotCleared, "error_path_not_cleared"),
    (Error::AlreadyCleared, "error_path_already_cleared"),
    (Error::AlreadySettled, "error_path_already_settled"),
    (Error::RoundVoided, "error_path_round_voided"),
    (Error::NotVoidable, "error_path_not_voidable"),
    (Error::WrongStatus, "error_path_wrong_status"),
    (Error::InvalidDrandSignature, "error_path_invalid_drand_signature"),
    (Error::HashMismatch, "error_path_hash_mismatch"),
    (Error::AlreadyRevealed, "error_path_already_revealed"),
    (Error::PayloadTooLarge, "error_path_payload_too_large"),
    (Error::InvalidAmount, "error_path_invalid_amount"),
    (Error::BidExceedsEscrow, "error_path_bid_exceeds_escrow"),
    (Error::DeadlineInPast, "error_path_deadline_in_past"),
    (Error::NoValidBids, "error_path_no_valid_bids"),
    (Error::RoundFull, "error_path_round_full"),
    (Error::InvalidLimit, "error_path_invalid_limit"),
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

fn settle_happy_path(f: &Fixture, t_reveal: u64, commit_deadline: u64, reveal_deadline: u64) -> u64 {
    let operator = Address::generate(&f.env);
    let id = drand_round(
        f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );
    let alice = funded_bidder(f, 1_000);
    let a_nonce = commit_bid(f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);
    id
}

#[test]
fn error_paths_registry_covers_every_variant() {
    assert_eq!(
        ERROR_PATH_REGISTRY.len(),
        27,
        "update ERROR_PATH_REGISTRY when adding/removing Error variants"
    );
    for (variant, name) in ERROR_PATH_REGISTRY {
        assert!(
            !name.is_empty(),
            "{} must name a trigger test",
            super::variant_name(*variant)
        );
    }
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
fn error_path_not_initialized() {
    let f = setup();
    f.env.as_contract(&f.client.address, || {
        f.env.storage().instance().remove(&DataKey::Config);
    });
    assert_try_contract_err(f.client.try_get_config(), Error::NotInitialized);
}

/// Deploy-only boundary: `__constructor` uses `panic_with_error!(AlreadyInitialized)`
/// when Config already exists. Re-invoking the constructor after deploy is rejected
/// by the host (Abort) rather than a `Result`-shaped contract error, so this test
/// asserts that boundary and pins the discriminant used in the panic path.
#[test]
fn error_path_already_initialized_constructor_boundary() {
    let f = setup();
    assert_eq!(super::discriminant(Error::AlreadyInitialized), 2);

    let usdc = f.usdc_token.address.clone();
    let args = soroban_sdk::vec![
        &f.env,
        soroban_sdk::BytesN::from_array(&f.env, &[0u8; 192]).into_val(&f.env),
        soroban_sdk::BytesN::from_array(&f.env, &[0u8; 192]).into_val(&f.env),
        Bytes::from_array(&f.env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_").into_val(&f.env),
        GENESIS.into_val(&f.env),
        PERIOD.into_val(&f.env),
        usdc.into_val(&f.env),
    ];
    let res = f.env.try_invoke_contract::<(), Error>(
        &f.client.address,
        &Symbol::new(&f.env, "__constructor"),
        args,
    );
    assert!(
        res.is_err(),
        "re-invoking __constructor after deploy must fail (AlreadyInitialized boundary)"
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
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    // Status is Revealing (not Cleared/Settled/Voided) → RevealAlreadyOpen.
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
fn error_path_already_cleared() {
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
    assert_try_contract_err(f.client.try_clear(&id), Error::AlreadyCleared);
}

#[test]
fn error_path_already_settled() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let id = settle_happy_path(&f, t_reveal, commit_deadline, reveal_deadline);
    assert_try_contract_err(f.client.try_settle(&id), Error::AlreadySettled);
}

#[test]
fn error_path_round_voided() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let alice = funded_bidder(&f, 500);
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f.client.void(&id);
    assert_try_contract_err(f.client.try_void(&id), Error::RoundVoided);
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
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
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
fn error_path_bid_exceeds_escrow() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    // Commit H for value=600 while locking only 500 escrow.
    let nonce = b32(&f.env, 0x01);
    let h = commitment(&f.env, 600, &nonce);
    f.client.commit(
        &id,
        &alice,
        &h,
        &Bytes::from_array(&f.env, b"sealed"),
        &500,
        &Bytes::from_array(&f.env, b"id-blob"),
    );
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert_try_contract_err(
        f.client.try_reveal(&id, &alice, &600, &nonce),
        Error::BidExceedsEscrow,
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
