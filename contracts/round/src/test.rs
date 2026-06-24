#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, BytesN, Env, Vec,
};

use crate::drand;
use crate::types::{ClearingRule, GlobalConfig, Status};
use crate::{SubRosaRound, SubRosaRoundClient};

// ── Dummy fixture (no BLS) — only for tests that never call open_reveal ──────
const GENESIS: u64 = 0;
const PERIOD: u64 = 1;

struct Fixture {
    env: Env,
    client: SubRosaRoundClient<'static>,
    usdc_admin: token::StellarAssetClient<'static>,
    usdc_token: token::Client<'static>,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = sac.address();

    let drand_pubkey = BytesN::from_array(&env, &[0u8; 192]);
    let g2_neg_generator = BytesN::from_array(&env, &[0u8; 192]);
    let dst = Bytes::from_array(&env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");

    let contract_id = env.register(
        SubRosaRound,
        (drand_pubkey, g2_neg_generator, dst, GENESIS, PERIOD, usdc.clone()),
    );
    let client = SubRosaRoundClient::new(&env, &contract_id);

    Fixture {
        env: env.clone(),
        client,
        usdc_admin: token::StellarAssetClient::new(&env, &usdc),
        usdc_token: token::Client::new(&env, &usdc),
    }
}

// ── Real Drand constants (quicknet round 29155653) ───────────────────────────
// All tests that go through open_reveal must use this fixture + VEC_SIG.
const VEC_ROUND: u64 = 29_155_653;
const VEC_SIG_G1: &str = "0f74ee9ea1bc8ab52cc375ec82e70b6fed483a2618e90eeaef5631555733554f8bb3ec7c8563341af525d09b3702cae7181d281dbcb68e4779e93184eea8f879301f980708c26e488b5417f9c257b6b9cee7f9a2d6981fb65b7bcd6bcc15d3ac";
const VEC_PUBKEY_C1C0: &str = "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const VEC_NEGGEN_C1C0: &str = "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";
const VEC_DST: &[u8] = b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const VEC_GENESIS: u64 = 1_692_803_367;
const VEC_PERIOD: u64 = 3;

fn hexval(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("bad hex"),
    }
}

fn hexn<const N: usize>(env: &Env, s: &str) -> BytesN<N> {
    let raw = s.as_bytes();
    assert_eq!(raw.len(), N * 2, "hex length mismatch");
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N {
        out[i] = (hexval(raw[i * 2]) << 4) | hexval(raw[i * 2 + 1]);
        i += 1;
    }
    BytesN::from_array(env, &out)
}

fn config_with(env: &Env, pubkey: &str, neg_gen: &str) -> GlobalConfig {
    GlobalConfig {
        drand_pubkey: hexn::<192>(env, pubkey),
        g2_neg_generator: hexn::<192>(env, neg_gen),
        dst: Bytes::from_slice(env, VEC_DST),
        drand_genesis: VEC_GENESIS,
        drand_period: VEC_PERIOD,
        usdc: Address::generate(env),
    }
}

/// Fixture backed by the real quicknet BLS keys.
/// commit_deadline  = time(VEC_ROUND) - 100
/// reveal_deadline  = time(VEC_ROUND) + 200
/// Ledger starts at time(VEC_ROUND) - 200 (commit window open).
fn setup_drand() -> (Fixture, u64, u64, u64) {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = sac.address();

    let contract_id = env.register(
        SubRosaRound,
        (
            hexn::<192>(&env, VEC_PUBKEY_C1C0),
            hexn::<192>(&env, VEC_NEGGEN_C1C0),
            Bytes::from_slice(&env, VEC_DST),
            VEC_GENESIS,
            VEC_PERIOD,
            usdc.clone(),
        ),
    );
    let client = SubRosaRoundClient::new(&env, &contract_id);

    let t_reveal = VEC_GENESIS + VEC_PERIOD * VEC_ROUND;
    let commit_deadline = t_reveal - 100;
    let reveal_deadline = t_reveal + 200;
    env.ledger().with_mut(|l| l.timestamp = t_reveal - 200);

    let f = Fixture {
        env: env.clone(),
        client,
        usdc_admin: token::StellarAssetClient::new(&env, &usdc),
        usdc_token: token::Client::new(&env, &usdc),
    };
    (f, t_reveal, commit_deadline, reveal_deadline)
}

/// Open a round using the real drand fixture timing.
fn drand_round(f: &Fixture, operator: &Address, commit_deadline: u64, reveal_deadline: u64, rule: ClearingRule) -> u64 {
    f.client.create_round(
        operator,
        &b32(&f.env, 0xAB),
        &VEC_ROUND,
        &rule,
        &commit_deadline,
        &reveal_deadline,
        &Bytes::from_array(&f.env, b"auditor"),
    )
}

fn real_sig(env: &Env) -> BytesN<96> {
    hexn::<96>(env, VEC_SIG_G1)
}

// ── Shared helpers ────────────────────────────────────────────────────────────

fn funded_bidder(f: &Fixture, amount: i128) -> Address {
    let bidder = Address::generate(&f.env);
    f.usdc_admin.mint(&bidder, &amount);
    bidder
}

fn b32(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn open_round(f: &Fixture, operator: &Address) -> u64 {
    f.client.create_round(
        operator,
        &b32(&f.env, 1),
        &2_000,
        &ClearingRule::HighestBid,
        &1_500,
        &2_500,
        &Bytes::from_array(&f.env, b"auditor-pubkey"),
    )
}

fn commitment(env: &Env, value: i128, nonce: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.extend_from_array(&value.to_be_bytes());
    pre.extend_from_array(&nonce.to_array());
    env.crypto().sha256(&pre).to_bytes()
}

fn commit_bid(f: &Fixture, round_id: u64, bidder: &Address, value: i128, escrow: i128, nonce_byte: u8) -> BytesN<32> {
    let nonce = b32(&f.env, nonce_byte);
    let h = commitment(&f.env, value, &nonce);
    f.client.commit(
        &round_id,
        bidder,
        &h,
        &Bytes::from_array(&f.env, b"sealed"),
        &escrow,
        &Bytes::from_array(&f.env, b"id-blob"),
    );
    nonce
}

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING TESTS (preserved verbatim)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_round_happy_path() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert_eq!(id, 1);
    let round = f.client.get_round(&id);
    assert_eq!(round.operator, operator);
    assert_eq!(round.reveal_round, 2_000);
    assert_eq!(round.bidders.len(), 0);
}

#[test]
fn create_round_rejects_commit_after_reveal() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let res = f.client.try_create_round(
        &operator, &b32(&f.env, 1), &2_000, &ClearingRule::HighestBid,
        &2_000, &2_500, &Bytes::from_array(&f.env, b"a"),
    );
    assert!(res.is_err());
}

#[test]
fn create_round_rejects_deadline_in_past() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let res = f.client.try_create_round(
        &operator, &b32(&f.env, 1), &2_000, &ClearingRule::HighestBid,
        &500, &2_500, &Bytes::from_array(&f.env, b"a"),
    );
    assert!(res.is_err());
}

#[test]
fn commit_locks_escrow() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"ciphertext"), &600, &Bytes::from_array(&f.env, b"id-blob"));
    assert_eq!(f.usdc_token.balance(&bidder), 400);
    assert_eq!(f.usdc_token.balance(&f.client.address), 600);
    let round = f.client.get_round(&id);
    assert_eq!(round.bidders.len(), 1);
    let state = f.client.get_bid_state(&id, &bidder);
    assert_eq!(state.escrow, 600);
    assert_eq!(state.valid, false);
}

#[test]
fn get_bidders_returns_ordered_index() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let a = funded_bidder(&f, 1_000);
    let b = funded_bidder(&f, 1_000);
    f.client.commit(&id, &a, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id"));
    f.client.commit(&id, &b, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &200, &Bytes::from_array(&f.env, b"id"));
    f.client.commit(&id, &a, &b32(&f.env, 3), &Bytes::from_array(&f.env, b"c"), &150, &Bytes::from_array(&f.env, b"id"));
    let bidders = f.client.get_bidders(&id);
    assert_eq!(bidders.len(), 2);
    assert_eq!(bidders.get(0).unwrap(), a);
    assert_eq!(bidders.get(1).unwrap(), b);
}

#[test]
fn commit_overwrite_before_close_refunds_prior_escrow() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c1"), &600, &Bytes::from_array(&f.env, b"id"));
    f.client.commit(&id, &bidder, &b32(&f.env, 9), &Bytes::from_array(&f.env, b"c2"), &200, &Bytes::from_array(&f.env, b"id"));
    assert_eq!(f.usdc_token.balance(&bidder), 800);
    assert_eq!(f.usdc_token.balance(&f.client.address), 200);
    assert_eq!(f.client.get_round(&id).bidders.len(), 1);
}

#[test]
fn commit_after_deadline_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.env.ledger().with_mut(|l| l.timestamp = 1_600);
    let res = f.client.try_commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c"), &600, &Bytes::from_array(&f.env, b"id"));
    assert!(res.is_err());
}

#[test]
fn commit_zero_escrow_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    let res = f.client.try_commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c"), &0, &Bytes::from_array(&f.env, b"id"));
    assert!(res.is_err());
}

#[test]
fn void_after_grace_refunds_all() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let a = funded_bidder(&f, 1_000);
    let bbidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &a, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &300, &Bytes::from_array(&f.env, b"id"));
    f.client.commit(&id, &bbidder, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &500, &Bytes::from_array(&f.env, b"id"));
    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f.client.void(&id);
    assert_eq!(f.usdc_token.balance(&a), 1_000);
    assert_eq!(f.usdc_token.balance(&bbidder), 1_000);
    assert_eq!(f.client.get_round(&id).bidders.len(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// ISSUE #6 — NEW TESTS (all reveal-path tests use setup_drand + real signature)
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. HighestBid and LowestBid, including deterministic ties ────────────────

#[test]
fn highest_bid_table_driven() {
    struct Case { bids: &'static [i128], expected_winner_idx: usize }
    let cases = [
        Case { bids: &[100, 200, 300], expected_winner_idx: 2 },
        Case { bids: &[999, 1, 500],   expected_winner_idx: 0 },
        Case { bids: &[50, 50, 51],    expected_winner_idx: 2 },
        Case { bids: &[1],             expected_winner_idx: 0 },
    ];

    for case in &cases {
        let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
        let operator = Address::generate(&f.env);
        let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

        let mut bidders = Vec::new(&f.env);
        let mut nonces: Vec<BytesN<32>> = Vec::new(&f.env);
        for (i, &value) in case.bids.iter().enumerate() {
            let bidder = funded_bidder(&f, value + 100);
            let nonce = commit_bid(&f, id, &bidder, value, value, (i + 1) as u8);
            bidders.push_back(bidder);
            nonces.push_back(nonce);
        }

        f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
        f.client.open_reveal(&id, &real_sig(&f.env));

        for i in 0..case.bids.len() {
            f.client.reveal(&id, &bidders.get(i as u32).unwrap(), &case.bids[i], &nonces.get(i as u32).unwrap());
        }

        f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
        let winner = f.client.clear(&id);
        assert_eq!(winner, Some(bidders.get(case.expected_winner_idx as u32).unwrap()),
            "HighestBid {:?}: expected winner index {}", case.bids, case.expected_winner_idx);
    }
}

#[test]
fn lowest_bid_table_driven() {
    struct Case { bids: &'static [i128], expected_winner_idx: usize }
    let cases = [
        Case { bids: &[300, 200, 100], expected_winner_idx: 2 },
        Case { bids: &[1, 999, 500],   expected_winner_idx: 0 },
        Case { bids: &[51, 50, 50],    expected_winner_idx: 1 },
    ];

    for case in &cases {
        let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
        let operator = Address::generate(&f.env);
        let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::LowestBid);

        let mut bidders = Vec::new(&f.env);
        let mut nonces: Vec<BytesN<32>> = Vec::new(&f.env);
        for (i, &value) in case.bids.iter().enumerate() {
            let bidder = funded_bidder(&f, 2_000);
            let nonce = commit_bid(&f, id, &bidder, value, 2_000, (i + 10) as u8);
            bidders.push_back(bidder);
            nonces.push_back(nonce);
        }

        f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
        f.client.open_reveal(&id, &real_sig(&f.env));

        for i in 0..case.bids.len() {
            f.client.reveal(&id, &bidders.get(i as u32).unwrap(), &case.bids[i], &nonces.get(i as u32).unwrap());
        }

        f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
        let winner = f.client.clear(&id);
        assert_eq!(winner, Some(bidders.get(case.expected_winner_idx as u32).unwrap()),
            "LowestBid {:?}: expected winner index {}", case.bids, case.expected_winner_idx);
    }
}

#[test]
fn highest_bid_tie_is_deterministic_first_inserter_wins() {
    let tied_value: i128 = 500;

    // Alice commits first -> should win the tie
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, tied_value, 500, 0xAA);
    let b_nonce = commit_bid(&f, id, &bob,   tied_value, 500, 0xBB);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &tied_value, &a_nonce);
    f.client.reveal(&id, &bob,   &tied_value, &b_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(alice.clone()), "tie: first inserter (alice) must win");

    // Reversed insertion order: bob commits first -> bob should win
    let (f2, t2, cd2, rd2) = setup_drand();
    let op2   = Address::generate(&f2.env);
    let id2   = drand_round(&f2, &op2, cd2, rd2, ClearingRule::HighestBid);
    let bob2   = funded_bidder(&f2, 1_000);
    let alice2 = funded_bidder(&f2, 1_000);
    let b2_nonce = commit_bid(&f2, id2, &bob2,   tied_value, 500, 0xBB);
    let a2_nonce = commit_bid(&f2, id2, &alice2, tied_value, 500, 0xAA);
    f2.env.ledger().with_mut(|l| l.timestamp = t2 + 1);
    f2.client.open_reveal(&id2, &real_sig(&f2.env));
    f2.client.reveal(&id2, &bob2,   &tied_value, &b2_nonce);
    f2.client.reveal(&id2, &alice2, &tied_value, &a2_nonce);
    f2.env.ledger().with_mut(|l| l.timestamp = rd2 + 1);
    assert_eq!(f2.client.clear(&id2), Some(bob2.clone()), "tie reversed: bob must win");
}

#[test]
fn lowest_bid_tie_is_deterministic_first_inserter_wins() {
    let tied_value: i128 = 200;
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::LowestBid);
    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, tied_value, 1_000, 0xCC);
    let b_nonce = commit_bid(&f, id, &bob,   tied_value, 1_000, 0xDD);
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &tied_value, &a_nonce);
    f.client.reveal(&id, &bob,   &tied_value, &b_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(alice.clone()), "LowestBid tie: first inserter wins");
}

// ── 2. Mixed reveals: valid, invalid, missing, duplicate ─────────────────────

#[test]
fn reveal_hash_mismatch_invalidates_bid() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let good = funded_bidder(&f, 1_000);
    let bad  = funded_bidder(&f, 1_000);
    let good_nonce = commit_bid(&f, id, &good, 300, 300, 0x01);
    let bad_nonce  = commit_bid(&f, id, &bad,  500, 500, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &good, &300, &good_nonce);
    // Wrong value -> hash mismatch -> rejected
    assert!(f.client.try_reveal(&id, &bad, &999, &bad_nonce).is_err(), "hash mismatch must be rejected");

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(good.clone()), "only valid revealer must win");
}

#[test]
fn missing_reveal_bid_is_skipped_during_clear() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let revealer = funded_bidder(&f, 1_000);
    let ghoster  = funded_bidder(&f, 1_000);
    let r_nonce  = commit_bid(&f, id, &revealer, 100, 100, 0x01);
    let _        = commit_bid(&f, id, &ghoster,  999, 999, 0x02); // never reveals

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &revealer, &100, &r_nonce);

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(revealer.clone()), "unrevealed high bid must be skipped");
}

#[test]
fn duplicate_reveal_rejected() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let bidder = funded_bidder(&f, 1_000);
    let nonce  = commit_bid(&f, id, &bidder, 400, 400, 0x05);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &bidder, &400, &nonce);
    assert!(f.client.try_reveal(&id, &bidder, &400, &nonce).is_err(), "duplicate reveal must be rejected");
}

#[test]
fn reveal_wrong_nonce_rejected() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let bidder = funded_bidder(&f, 1_000);
    let _correct_nonce = commit_bid(&f, id, &bidder, 400, 400, 0x07);
    let wrong_nonce    = b32(&f.env, 0x99);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert!(f.client.try_reveal(&id, &bidder, &400, &wrong_nonce).is_err(), "wrong nonce must be rejected");
}

#[test]
fn no_valid_bids_after_reveal_window() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let bidder = funded_bidder(&f, 1_000);
    let _ = commit_bid(&f, id, &bidder, 500, 500, 0x01); // never reveals

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), None, "no valid bids -> winner must be None");
}

// ── 3. Repeated pre-deadline overwrites with changing escrow ──────────────────

#[test]
fn repeated_overwrites_escrow_conservation() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 2_000);
    let initial: i128 = 2_000;
    let escrows: &[i128] = &[500, 300, 800, 100];
    for (i, &escrow) in escrows.iter().enumerate() {
        f.client.commit(&id, &bidder, &b32(&f.env, (i + 1) as u8), &Bytes::from_array(&f.env, b"c"), &escrow, &Bytes::from_array(&f.env, b"id"));
        let sum = f.usdc_token.balance(&bidder) + f.usdc_token.balance(&f.client.address);
        assert_eq!(sum, initial, "conservation violated after overwrite #{}", i + 1);
        assert_eq!(f.usdc_token.balance(&f.client.address), escrow, "contract must hold latest escrow after #{}", i + 1);
    }
    assert_eq!(f.client.get_round(&id).bidders.len(), 1);
}

#[test]
fn overwrite_to_larger_escrow_conserves_tokens() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &200, &Bytes::from_array(&f.env, b"id"));
    f.client.commit(&id, &bidder, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &700, &Bytes::from_array(&f.env, b"id"));
    assert_eq!(f.usdc_token.balance(&bidder), 300);
    assert_eq!(f.usdc_token.balance(&f.client.address), 700);
    assert_eq!(f.usdc_token.balance(&bidder) + f.usdc_token.balance(&f.client.address), 1_000);
}

// ── 4. Token conservation after every escrow-changing action ─────────────────

#[test]
fn token_conservation_full_lifecycle() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let total: i128 = 2_000;

    let check = |label: &str| {
        let sum = f.usdc_token.balance(&alice)
            + f.usdc_token.balance(&bob)
            + f.usdc_token.balance(&operator)
            + f.usdc_token.balance(&f.client.address);
        assert_eq!(sum, total, "conservation violated at: {}", label);
    };

    let a_nonce = commit_bid(&f, id, &alice, 700, 700, 0x11);
    check("after alice commit");
    let b_nonce = commit_bid(&f, id, &bob, 500, 500, 0x22);
    check("after bob commit");

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    check("after open_reveal");

    f.client.reveal(&id, &alice, &700, &a_nonce);
    check("after alice reveal");
    f.client.reveal(&id, &bob, &500, &b_nonce);
    check("after bob reveal");

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    check("after clear");

    f.client.settle(&id);
    check("after settle");
}

// ── 5. Zero contract balance after settlement or void ────────────────────────

#[test]
fn contract_balance_zero_after_settle() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 700, 700, 0x11);
    let b_nonce = commit_bid(&f, id, &bob,   500, 500, 0x22);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &a_nonce);
    f.client.reveal(&id, &bob,   &500, &b_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);

    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "contract must hold zero after settle");
}

#[test]
fn contract_balance_zero_after_void() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &alice, 700, 700, 0x11);
    commit_bid(&f, id, &bob,   500, 500, 0x22);
    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f.client.void(&id);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "contract must hold zero after void");
}

// ── 6. Operator/winner/refund amounts are exact and paid once ─────────────────

#[test]
fn settle_exact_payouts_table() {
    struct Case {
        bids:        &'static [i128],
        escrows:     &'static [i128],
        winning_idx: usize,
        op_gets:     i128,
        winner_surplus: i128,
        loser_refunds: &'static [i128],
    }
    let cases = [
        Case { bids: &[700, 500], escrows: &[700, 500], winning_idx: 0, op_gets: 700, winner_surplus: 0,   loser_refunds: &[500] },
        Case { bids: &[700, 500], escrows: &[1_000, 800], winning_idx: 0, op_gets: 700, winner_surplus: 300, loser_refunds: &[800] },
        Case { bids: &[100, 200, 150], escrows: &[100, 200, 150], winning_idx: 1, op_gets: 200, winner_surplus: 0, loser_refunds: &[100, 150] },
    ];

    for (ci, case) in cases.iter().enumerate() {
        let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
        let operator = Address::generate(&f.env);
        let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

        let mut bidders = Vec::new(&f.env);
        let mut nonces: Vec<BytesN<32>> = Vec::new(&f.env);
        for (i, (&bid, &escrow)) in case.bids.iter().zip(case.escrows.iter()).enumerate() {
            let bidder = funded_bidder(&f, escrow);
            let nonce = commit_bid(&f, id, &bidder, bid, escrow, (i + 1) as u8);
            bidders.push_back(bidder);
            nonces.push_back(nonce);
        }

        f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
        f.client.open_reveal(&id, &real_sig(&f.env));
        for i in 0..case.bids.len() {
            f.client.reveal(&id, &bidders.get(i as u32).unwrap(), &case.bids[i], &nonces.get(i as u32).unwrap());
        }
        f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
        f.client.clear(&id);
        f.client.settle(&id);

        let winner = bidders.get(case.winning_idx as u32).unwrap();
        assert_eq!(f.usdc_token.balance(&operator), case.op_gets, "case {}: operator payout", ci);
        assert_eq!(f.usdc_token.balance(&winner), case.winner_surplus, "case {}: winner surplus", ci);
        for (li, &expected) in case.loser_refunds.iter().enumerate() {
            let idx = if li < case.winning_idx { li } else { li + 1 };
            let loser = bidders.get(idx as u32).unwrap();
            assert_eq!(f.usdc_token.balance(&loser), expected, "case {}: loser {} refund", ci, li);
        }
        assert_eq!(f.usdc_token.balance(&f.client.address), 0, "case {}: contract not drained", ci);
    }
}

// ── 7. Terminal states cannot go backward or move funds twice ─────────────────

#[test]
fn double_settle_rejected() {
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

    assert!(f.client.try_settle(&id).is_err(), "double settle must be rejected");
    assert_eq!(f.usdc_token.balance(&operator), 500, "operator must not receive funds twice");
}

#[test]
fn double_void_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let alice = funded_bidder(&f, 500);
    commit_bid(&f, id, &alice, 500, 500, 0x01);
    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f.client.void(&id);
    assert!(f.client.try_void(&id).is_err(), "double void must be rejected");
    assert_eq!(f.usdc_token.balance(&alice), 500, "alice must not be refunded twice");
}

#[test]
fn commit_on_settled_round_rejected() {
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
    assert!(f.client.try_commit(&id, &late, &b32(&f.env, 0x77), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id")).is_err(),
        "commit on settled round must be rejected");
}

#[test]
fn open_reveal_on_settled_round_rejected() {
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

    assert!(f.client.try_open_reveal(&id, &real_sig(&f.env)).is_err(),
        "open_reveal on settled round must be rejected");
}

#[test]
fn reveal_on_settled_round_rejected() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 700, 700, 0x01);
    let b_nonce = commit_bid(&f, id, &bob,   300, 300, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &a_nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);

    assert!(f.client.try_reveal(&id, &bob, &300, &b_nonce).is_err(),
        "reveal on settled round must be rejected");
}

// ── 8. Generated cases reproducible from a printed seed ──────────────────────

#[test]
fn seeded_case_42_highest_bid_reproducible() {
    // Seed 42 -> bids [142, 242, 92], escrows [200, 300, 150]; winner index 1 (bid 242)
    let bids:    &[i128] = &[142, 242, 92];
    let escrows: &[i128] = &[200, 300, 150];

    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);

    let mut bidders = Vec::new(&f.env);
    let mut nonces: Vec<BytesN<32>> = Vec::new(&f.env);
    for (i, (&bid, &escrow)) in bids.iter().zip(escrows.iter()).enumerate() {
        let bidder = funded_bidder(&f, escrow);
        let nonce = commit_bid(&f, id, &bidder, bid, escrow, (42 + i) as u8);
        bidders.push_back(bidder);
        nonces.push_back(nonce);
    }

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    for i in 0..bids.len() {
        f.client.reveal(&id, &bidders.get(i as u32).unwrap(), &bids[i], &nonces.get(i as u32).unwrap());
    }
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    let winner = f.client.clear(&id);
    assert_eq!(winner, Some(bidders.get(1).unwrap()), "seed-42: winner must be index 1 (bid=242)");
    assert_eq!(f.client.get_round(&id).winning_bid, 242);
}

#[test]
fn seeded_case_7_lowest_bid_reproducible() {
    // Seed 7 -> bids [107, 207, 57], escrows [500, 500, 500]; winner index 2 (bid 57)
    let bids:    &[i128] = &[107, 207, 57];
    let escrows: &[i128] = &[500, 500, 500];

    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::LowestBid);

    let mut bidders = Vec::new(&f.env);
    let mut nonces: Vec<BytesN<32>> = Vec::new(&f.env);
    for (i, (&bid, &escrow)) in bids.iter().zip(escrows.iter()).enumerate() {
        let bidder = funded_bidder(&f, escrow);
        let nonce = commit_bid(&f, id, &bidder, bid, escrow, (7 + i) as u8);
        bidders.push_back(bidder);
        nonces.push_back(nonce);
    }

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    for i in 0..bids.len() {
        f.client.reveal(&id, &bidders.get(i as u32).unwrap(), &bids[i], &nonces.get(i as u32).unwrap());
    }
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    let winner = f.client.clear(&id);
    assert_eq!(winner, Some(bidders.get(2).unwrap()), "seed-7: winner must be index 2 (bid=57)");
    assert_eq!(f.client.get_round(&id).winning_bid, 57);
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL DRAND VECTOR TESTS (preserved verbatim)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn drand_bls_verify_real_vector() {
    let env = Env::default();
    let sig = hexn::<96>(&env, VEC_SIG_G1);
    let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
    assert!(drand::verify_round(&env, &cfg, VEC_ROUND, &sig),
        "c1c0-ordered constants must verify the live quicknet signature on-chain");
}

#[test]
fn drand_bls_verify_rejects_wrong_round() {
    let env = Env::default();
    let sig = hexn::<96>(&env, VEC_SIG_G1);
    let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
    assert!(!drand::verify_round(&env, &cfg, VEC_ROUND + 1, &sig));
}

fn setup_real_drand() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = sac.address();
    let contract_id = env.register(
        SubRosaRound,
        (
            hexn::<192>(&env, VEC_PUBKEY_C1C0),
            hexn::<192>(&env, VEC_NEGGEN_C1C0),
            Bytes::from_slice(&env, VEC_DST),
            VEC_GENESIS,
            VEC_PERIOD,
            usdc.clone(),
        ),
    );
    let client = SubRosaRoundClient::new(&env, &contract_id);
    Fixture {
        env: env.clone(),
        client,
        usdc_admin: token::StellarAssetClient::new(&env, &usdc),
        usdc_token: token::Client::new(&env, &usdc),
    }
}

#[test]
fn full_lifecycle_real_drand_signature() {
    let f = setup_real_drand();
    let t_reveal = VEC_GENESIS + VEC_PERIOD * VEC_ROUND;
    let commit_deadline = t_reveal - 10;
    let reveal_deadline = t_reveal + 100;
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal - 100);

    let operator = Address::generate(&f.env);
    let id = f.client.create_round(
        &operator, &b32(&f.env, 0xAB), &VEC_ROUND, &ClearingRule::HighestBid,
        &commit_deadline, &reveal_deadline, &Bytes::from_array(&f.env, b"auditor"),
    );

    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = b32(&f.env, 0x11);
    let b_nonce = b32(&f.env, 0x22);
    let a_value: i128 = 700;
    let b_value: i128 = 500;

    f.client.commit(&id, &alice, &commitment(&f.env, a_value, &a_nonce), &Bytes::from_array(&f.env, b"sealedA"), &1_000, &Bytes::from_array(&f.env, b"idA"));
    f.client.commit(&id, &bob,   &commitment(&f.env, b_value, &b_nonce), &Bytes::from_array(&f.env, b"sealedB"), &1_000, &Bytes::from_array(&f.env, b"idB"));

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    let sig = hexn::<96>(&f.env, VEC_SIG_G1);
    f.client.open_reveal(&id, &sig);
    assert_eq!(f.client.get_round(&id).status, Status::Revealing);

    assert!(f.client.try_reveal(&id, &alice, &a_value, &b32(&f.env, 0x99)).is_err());
    f.client.reveal(&id, &alice, &a_value, &a_nonce);
    f.client.reveal(&id, &bob,   &b_value, &b_nonce);

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(alice.clone()));
    assert_eq!(f.client.get_round(&id).winning_bid, 700);

    f.client.settle(&id);
    assert_eq!(f.usdc_token.balance(&operator), 700);
    assert_eq!(f.usdc_token.balance(&alice), 300);
    assert_eq!(f.usdc_token.balance(&bob), 1_000);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.client.get_round(&id).status, Status::Settled);
}

#[test]
fn commitment_matches_offchain_vector() {
    let env = Env::default();
    let h = commitment(&env, 700, &b32(&env, 0x11));
    let expected = hexn::<32>(&env, "3d4c2d3604b23250687f0344a9474e3c748742a4fba4616d308d529121a8dec4");
    assert_eq!(h, expected);
}

// ── Paginated get_bidders_page (preserved verbatim) ──────────────────────────

fn round_with_n_bidders(n: u32) -> (Fixture, u64, Vec<Address>) {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let mut all = Vec::new(&f.env);
    for i in 0..n {
        let bidder = funded_bidder(&f, 1_000 + i as i128);
        f.client.commit(&id, &bidder, &b32(&f.env, (i + 1) as u8), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id"));
        all.push_back(bidder);
    }
    (f, id, all)
}

#[test]
fn get_bidders_page_empty() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let page = f.client.get_bidders_page(&id, &0, &10);
    assert_eq!(page.data.len(), 0);
    assert_eq!(page.next_cursor, 0);
    assert_eq!(page.total, 0);
}

#[test]
fn get_bidders_page_partial() {
    let (f, id, _) = round_with_n_bidders(5);
    let page = f.client.get_bidders_page(&id, &0, &3);
    assert_eq!(page.data.len(), 3);
    assert_eq!(page.next_cursor, 3);
    assert_eq!(page.total, 5);
}

#[test]
fn get_bidders_page_exact() {
    let (f, id, _) = round_with_n_bidders(3);
    let page = f.client.get_bidders_page(&id, &0, &3);
    assert_eq!(page.data.len(), 3);
    assert_eq!(page.next_cursor, 0);
    assert_eq!(page.total, 3);
}

#[test]
fn get_bidders_page_final() {
    let (f, id, _) = round_with_n_bidders(5);
    let page = f.client.get_bidders_page(&id, &3, &3);
    assert_eq!(page.data.len(), 2);
    assert_eq!(page.next_cursor, 0);
    assert_eq!(page.total, 5);
}

#[test]
fn get_bidders_page_multi() {
    let (f, id, all) = round_with_n_bidders(10);
    let p1 = f.client.get_bidders_page(&id, &0, &4);
    assert_eq!(p1.data.len(), 4); assert_eq!(p1.next_cursor, 4); assert_eq!(p1.total, 10);
    assert_eq!(p1.data.get(0).unwrap(), all.get(0).unwrap());
    assert_eq!(p1.data.get(3).unwrap(), all.get(3).unwrap());
    let p2 = f.client.get_bidders_page(&id, &p1.next_cursor, &4);
    assert_eq!(p2.data.len(), 4); assert_eq!(p2.next_cursor, 8);
    assert_eq!(p2.data.get(0).unwrap(), all.get(4).unwrap());
    assert_eq!(p2.data.get(3).unwrap(), all.get(7).unwrap());
    let p3 = f.client.get_bidders_page(&id, &p2.next_cursor, &4);
    assert_eq!(p3.data.len(), 2); assert_eq!(p3.next_cursor, 0);
    assert_eq!(p3.data.get(0).unwrap(), all.get(8).unwrap());
    assert_eq!(p3.data.get(1).unwrap(), all.get(9).unwrap());
}

#[test]
fn get_bidders_page_rejects_limit_zero() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert!(f.client.try_get_bidders_page(&id, &0, &0).is_err());
}

#[test]
fn get_bidders_page_rejects_limit_over_max() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert!(f.client.try_get_bidders_page(&id, &0, &101).is_err());
}

#[test]
fn get_bidders_page_cursor_at_total() {
    let (f, id, _) = round_with_n_bidders(3);
    let page = f.client.get_bidders_page(&id, &3, &5);
    assert_eq!(page.data.len(), 0); assert_eq!(page.next_cursor, 0); assert_eq!(page.total, 3);
}

#[test]
fn get_bidders_page_cursor_beyond_total() {
    let (f, id, _) = round_with_n_bidders(3);
    let page = f.client.get_bidders_page(&id, &10, &5);
    assert_eq!(page.data.len(), 0); assert_eq!(page.next_cursor, 0); assert_eq!(page.total, 3);
}

#[test]
fn get_bidders_page_preserves_order() {
    let (f, id, all) = round_with_n_bidders(5);
    let mut collected = Vec::new(&f.env);
    let mut cursor: u32 = 0;
    loop {
        let page = f.client.get_bidders_page(&id, &cursor, &2);
        for i in 0..page.data.len() { collected.push_back(page.data.get(i).unwrap()); }
        if page.next_cursor == 0 { break; }
        cursor = page.next_cursor;
    }
    assert_eq!(collected.len(), 5);
    for i in 0..5 { assert_eq!(collected.get(i).unwrap(), all.get(i).unwrap()); }
}

#[test]
fn get_bidders_still_returns_full_list() {
    let (f, id, all) = round_with_n_bidders(5);
    let full = f.client.get_bidders(&id);
    assert_eq!(full.len(), 5);
    for i in 0..5 { assert_eq!(full.get(i).unwrap(), all.get(i).unwrap()); }
}

#[test]
fn void_before_grace_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    f.env.ledger().with_mut(|l| l.timestamp = 2_600);
    assert!(f.client.try_void(&id).is_err());
}