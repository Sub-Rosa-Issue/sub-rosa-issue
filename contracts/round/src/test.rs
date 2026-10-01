#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, BytesN, ConversionError, Env, InvokeError, String, Vec,
};
use soroban_sdk::testutils::storage::Temporary as TemporaryStorageTest;

use crate::drand;
use crate::storage::{
    get_round, get_state, seal_ttl_for_reveal_deadline, set_round, set_state, try_get_ledger,
    TEMP_THRESHOLD,
};
use crate::types::{
    BidState, ClearingRule, DataKey, Error, EscrowLedger, GlobalConfig, Round, Status,
};
use crate::{conserved, SubRosaRound, SubRosaRoundClient};

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
pub(super) const VEC_ROUND: u64 = 29_155_653;
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
        &native_xlm(&f.env),
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

/// Native XLM asset config, the default for tests that don't exercise SAC
/// binding. `create_round` takes it on every call but does not itself validate
/// the fields, so tests that only need a well-formed round pass this.
pub fn native_xlm(env: &Env) -> RoundAssetConfig {
    RoundAssetConfig {
        asset_type: String::from_str(env, "native"),
        contract_id: String::from_str(env, ""),
        code: String::from_str(env, "XLM"),
        decimals: 7,
        issuer: String::from_str(env, ""),
    }
}

fn open_round(f: &Fixture, operator: &Address) -> u64 {
    let asset_config = sac_asset_config(&f.env);
    f.client.create_round(
        operator,
        &b32(&f.env, 1),
        &2_000,
        &ClearingRule::HighestBid,
        &1_500,
        &2_500,
        &Bytes::from_array(&f.env, b"auditor-pubkey"),
        &native_xlm(&f.env),
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
    let round = f.client.get_round(&round_id);
    f.client.commit(
        &round_id,
        bidder,
        &h,
        &Bytes::from_array(&f.env, b"sealed"),
        &escrow,
        &Bytes::from_array(&f.env, b"id-blob"),
        &round.reveal_round,
    );
    nonce
}

fn assert_try_contract_err<T>(
    result: Result<Result<T, ConversionError>, Result<Error, InvokeError>>,
    expected: Error,
) {
    match result {
        Err(Ok(got)) => {
            assert_eq!(
                got, expected,
                "expected {} ({})",
                variant_name(expected),
                expected as u32,
            );
        }
        Err(Err(InvokeError::Contract(code))) => {
            assert_eq!(
                code,
                expected as u32,
                "expected {} ({})",
                variant_name(expected),
                expected as u32,
            );
        }
        Err(Err(other)) => panic!(
            "expected {} ({}), got invoke error {:?}",
            variant_name(expected),
            expected as u32,
            other,
        ),
        Ok(Ok(_)) => panic!(
            "expected contract error {} ({}), call succeeded",
            variant_name(expected),
            expected as u32,
        ),
        Ok(Err(conv)) => panic!("argument conversion error: {:?}", conv),
    }
}

fn assert_try_create_round_err(
    result: Result<
        Result<u64, soroban_sdk::Error>,
        Result<Error, InvokeError>,
    >,
    expected: Error,
) {
    match result {
        Err(Ok(got)) => {
            assert_eq!(
                got, expected,
                "expected {} ({})",
                variant_name(expected),
                expected as u32,
            );
        }
        Err(Err(InvokeError::Contract(code))) => {
            assert_eq!(
                code,
                expected as u32,
                "expected {} ({})",
                variant_name(expected),
                expected as u32,
            );
        }
        Err(Err(other)) => panic!(
            "expected {} ({}), got invoke error {:?}",
            variant_name(expected),
            expected as u32,
            other,
        ),
        Ok(Ok(_)) => panic!(
            "expected contract error {} ({}), call succeeded",
            variant_name(expected),
            expected as u32,
        ),
        Ok(Err(conv)) => panic!("return value conversion error: {:?}", conv),
    }
}

#[path = "error_paths.rs"]
mod error_paths;

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
        &2_000, &2_500, &Bytes::from_array(&f.env, b"a"), &native_xlm(&f.env),
    );
    assert!(res.is_err());
}

#[test]
fn create_round_rejects_deadline_in_past() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let res = f.client.try_create_round(
        &operator, &b32(&f.env, 1), &2_000, &ClearingRule::HighestBid,
        &500, &2_500, &Bytes::from_array(&f.env, b"a"), &native_xlm(&f.env),
    );
    assert!(res.is_err());
}

/// Issue #376: a reveal round the quicknet chain can never publish — genesis +
/// period×R overflows u64 — must fail create_round instead of saturating into
/// a far-future deadline that would strand the round past the void window.
#[test]
fn create_round_rejects_overflowing_reveal_round() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let res = f.client.try_create_round(
        &operator, &b32(&f.env, 1), &u64::MAX, &ClearingRule::HighestBid,
        &1_500, &2_500, &Bytes::from_array(&f.env, b"a"),
    );
    assert!(res.is_err());
}

#[test]
fn commit_locks_escrow() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"ciphertext"), &600, &Bytes::from_array(&f.env, b"id-blob"), &2_000);
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
    f.client.commit(&id, &a, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id"), &2_000);
    f.client.commit(&id, &b, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &200, &Bytes::from_array(&f.env, b"id"), &2_000);
    f.client.commit(&id, &a, &b32(&f.env, 3), &Bytes::from_array(&f.env, b"c"), &150, &Bytes::from_array(&f.env, b"id"), &2_000);
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
    f.client.commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c1"), &600, &Bytes::from_array(&f.env, b"id"), &2_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 9), &Bytes::from_array(&f.env, b"c2"), &200, &Bytes::from_array(&f.env, b"id"), &2_000);
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
    let res = f.client.try_commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c"), &600, &Bytes::from_array(&f.env, b"id"), &2_000);
    assert!(res.is_err());
}

#[test]
fn commit_zero_escrow_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    let res = f.client.try_commit(&id, &bidder, &b32(&f.env, 7), &Bytes::from_array(&f.env, b"c"), &0, &Bytes::from_array(&f.env, b"id"), &2_000);
    assert!(res.is_err());
}

#[test]
fn void_after_grace_refunds_all() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let a = funded_bidder(&f, 1_000);
    let bbidder = funded_bidder(&f, 1_000);
    f.client.commit(&id, &a, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &300, &Bytes::from_array(&f.env, b"id"), &2_000);
    f.client.commit(&id, &bbidder, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &500, &Bytes::from_array(&f.env, b"id"), &2_000);
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
        f.client.commit(&id, &bidder, &b32(&f.env, (i + 1) as u8), &Bytes::from_array(&f.env, b"c"), &escrow, &Bytes::from_array(&f.env, b"id"), &2_000);
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
    f.client.commit(&id, &bidder, &b32(&f.env, 1), &Bytes::from_array(&f.env, b"c"), &200, &Bytes::from_array(&f.env, b"id"), &2_000);
    f.client.commit(&id, &bidder, &b32(&f.env, 2), &Bytes::from_array(&f.env, b"c"), &700, &Bytes::from_array(&f.env, b"id"), &2_000);
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
    assert!(f.client.try_commit(&id, &late, &b32(&f.env, 0x77), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id"), &2_000).is_err(),
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

// #[test]
// fn drand_bls_verify_real_vector() {
//     let env = Env::default();
//     let sig = hexn::<96>(&env, VEC_SIG_G1);
//     let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
//     assert!(drand::verify_round(&env, &cfg, VEC_ROUND, &sig),
//         "c1c0-ordered constants must verify the live quicknet signature on-chain");
// }

// #[test]
// fn drand_bls_verify_rejects_wrong_round() {
//     let env = Env::default();
//     let sig = hexn::<96>(&env, VEC_SIG_G1);
//     let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
//     assert!(!drand::verify_round(&env, &cfg, VEC_ROUND + 1, &sig));
// }

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DRAND VECTOR TESTS (Issue #404)
// ─────────────────────────────────────────────────────────────────────────────

fn get_vector_json() -> &'static str {
    include_str!("../../../services/drand-tools/src/drand_vectors.json")
}

fn get_json_string<'a>(json: &'a str, key_pattern: &str) -> &'a str {
    let start = json
        .find(key_pattern)
        .unwrap_or_else(|| panic!("pattern {} not found", key_pattern))
        + key_pattern.len();
    let mut val = &json[start..];
    val = val.trim_start();
    if val.starts_with('"') {
        val = &val[1..];
        let end = val.find('"').unwrap();
        &val[..end]
    } else {
        let end = val
            .find(|c: char| c == ',' || c == '\n' || c == '}')
            .unwrap_or(val.len());
        val[..end].trim()
    }
}

fn get_json_u64(json: &str, key_pattern: &str) -> u64 {
    get_json_string(json, key_pattern).parse().unwrap()
}

#[test]
fn shared_vector_accepted_on_both_sides() {
    let env = Env::default();
    let json = get_vector_json();

    let round = get_json_u64(json, "\"round\":");
    let sig_g1 = get_json_string(json, "\"sig_g1\":");
    let pubkey = get_json_string(json, "\"pubkey_c1c0\":");
    let neggen = get_json_string(json, "\"neggen_c1c0\":");

    let sig = hexn::<96>(&env, sig_g1);
    let cfg = config_with(&env, pubkey, neggen);

    assert!(
        drand::verify_round(&env, &cfg, round, &sig),
        "valid offline vector must be accepted"
    );
}

#[test]
fn shared_vector_wrong_round_rejected() {
    let env = Env::default();
    let json = get_vector_json();

    let sig_g1 = get_json_string(json, "\"sig_g1\":");
    let pubkey = get_json_string(json, "\"pubkey_c1c0\":");
    let neggen = get_json_string(json, "\"neggen_c1c0\":");
    let wrong_round = get_json_u64(json, "\"invalidWrongRound\":");

    let sig = hexn::<96>(&env, sig_g1);
    let cfg = config_with(&env, pubkey, neggen);

    assert!(
        !drand::verify_round(&env, &cfg, wrong_round, &sig),
        "wrong round offline vector must be rejected"
    );
}

#[test]
#[should_panic(expected = "hex length mismatch")]
fn shared_vector_truncated_signature_rejected() {
    let env = Env::default();
    let json = get_vector_json();
    let trunc_sig = get_json_string(json, "\"invalidTruncatedSignature\":");

    // The ABI strictly requires exactly 96 bytes. This mirrors the Soroban VM 
    // rejecting the transaction during argument conversion before open_reveal runs.
    hexn::<96>(&env, trunc_sig);
}

#[test]
#[should_panic(expected = "hex length mismatch")]
fn shared_vector_empty_signature_rejected() {
    let env = Env::default();
    let json = get_vector_json();
    let empty_sig = get_json_string(json, "\"invalidEmptySignature\":");
    
    hexn::<96>(&env, empty_sig);
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
        &native_xlm(&f.env),
    );

    let alice = funded_bidder(&f, 1_000);
    let bob   = funded_bidder(&f, 1_000);
    let a_nonce = b32(&f.env, 0x11);
    let b_nonce = b32(&f.env, 0x22);
    let a_value: i128 = 700;
    let b_value: i128 = 500;

    f.client.commit(&id, &alice, &commitment(&f.env, a_value, &a_nonce), &Bytes::from_array(&f.env, b"sealedA"), &1_000, &Bytes::from_array(&f.env, b"idA"), &VEC_ROUND);
    f.client.commit(&id, &bob,   &commitment(&f.env, b_value, &b_nonce), &Bytes::from_array(&f.env, b"sealedB"), &1_000, &Bytes::from_array(&f.env, b"idB"), &VEC_ROUND);

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
        f.client.commit(&id, &bidder, &b32(&f.env, (i + 1) as u8), &Bytes::from_array(&f.env, b"c"), &100, &Bytes::from_array(&f.env, b"id"), &2_000);
        all.push_back(bidder);
    }
    (f, id, all)
}

#[test]
fn get_bidders_page_empty() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let page = f.client.get_bidders_page(&id, &None, &10);
    assert_eq!(page.data.len(), 0);
    assert!(page.next_cursor.is_none()); assert!(!page.has_more);
    assert_eq!(page.total, 0);
}

#[test]
fn get_bidders_page_partial() {
    let (f, id, _) = round_with_n_bidders(5);
    let page = f.client.get_bidders_page(&id, &None, &3);
    assert_eq!(page.data.len(), 3);
    assert!(page.next_cursor.is_some()); assert!(page.has_more);
    assert_eq!(page.total, 5);
}

#[test]
fn get_bidders_page_exact() {
    let (f, id, _) = round_with_n_bidders(3);
    let page = f.client.get_bidders_page(&id, &None, &3);
    assert_eq!(page.data.len(), 3);
    assert!(page.next_cursor.is_none()); assert!(!page.has_more);
    assert_eq!(page.total, 3);
}

#[test]
fn get_bidders_page_final() {
    let (f, id, _) = round_with_n_bidders(5);
    let first = f.client.get_bidders_page(&id, &None, &3);
    let page = f.client.get_bidders_page(&id, &first.next_cursor, &3);
    assert_eq!(page.data.len(), 2);
    assert!(page.next_cursor.is_none()); assert!(!page.has_more);
    assert_eq!(page.total, 5);
}

#[test]
fn get_bidders_page_multi() {
    let (f, id, all) = round_with_n_bidders(10);
    let p1 = f.client.get_bidders_page(&id, &None, &4);
    assert_eq!(p1.data.len(), 4); assert!(p1.next_cursor.is_some()); assert!(p1.has_more); assert_eq!(p1.total, 10);
    assert_eq!(p1.data.get(0).unwrap(), all.get(0).unwrap());
    assert_eq!(p1.data.get(3).unwrap(), all.get(3).unwrap());
    let p2 = f.client.get_bidders_page(&id, &p1.next_cursor, &4);
    assert_eq!(p2.data.len(), 4); assert!(p2.next_cursor.is_some()); assert!(p2.has_more);
    assert_eq!(p2.data.get(0).unwrap(), all.get(4).unwrap());
    assert_eq!(p2.data.get(3).unwrap(), all.get(7).unwrap());
    let p3 = f.client.get_bidders_page(&id, &p2.next_cursor, &4);
    assert_eq!(p3.data.len(), 2); assert!(p3.next_cursor.is_none()); assert!(!p3.has_more);
    assert_eq!(p3.data.get(0).unwrap(), all.get(8).unwrap());
    assert_eq!(p3.data.get(1).unwrap(), all.get(9).unwrap());
}

#[test]
fn get_bidders_page_rejects_limit_zero() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert!(f.client.try_get_bidders_page(&id, &None, &0).is_err());
}

#[test]
fn get_bidders_page_rejects_limit_over_max() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert!(f.client.try_get_bidders_page(&id, &None, &101).is_err());
}

#[test]
fn get_bidders_page_cursor_at_total() {
    let (f, id, _) = round_with_n_bidders(3);
    let first = f.client.get_bidders_page(&id, &None, &3);
    assert!(!first.has_more);
    assert!(first.next_cursor.is_none());
}

#[test]
fn get_bidders_page_cursor_beyond_total() {
    let (f, id, _) = round_with_n_bidders(3);
    assert_try_contract_err(
        f.client.try_get_bidders_page(&id, &Some(Bytes::from_array(&f.env, &[1; 41])), &5),
        Error::InvalidCursor,
    );
}

#[test]
fn get_bidders_page_preserves_order() {
    let (f, id, all) = round_with_n_bidders(5);
    let mut collected = Vec::new(&f.env);
    let mut cursor = None;
    loop {
        let page = f.client.get_bidders_page(&id, &cursor, &2);
        for i in 0..page.data.len() { collected.push_back(page.data.get(i).unwrap()); }
        if !page.has_more { break; }
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

// ── Storage expiration and cleanup coverage (#51) ────────────────────────────

fn seal_key(round_id: u64, bidder: &Address) -> DataKey {
    DataKey::Seal(round_id, bidder.clone())
}

fn temporary_seal_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.env.as_contract(&f.client.address, || {
        f.env.storage().temporary().get_ttl(key)
    })
}

fn advance_ledgers(f: &Fixture, count: u32) {
    let seq = f.env.ledger().sequence();
    f.env.ledger().set_sequence_number(seq + count);
}

fn active_round_with_bidder() -> (Fixture, u64, Address, u64) {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &bidder, 500, 1_000, 0x01);
    let reveal_deadline = f.client.get_round(&id).reveal_deadline;
    (f, id, bidder, reveal_deadline)
}

#[test]
fn active_round_seal_ttl_covers_reveal_window() {
    let (f, id, bidder, reveal_deadline) = active_round_with_bidder();
    let now = f.env.ledger().timestamp();
    let expected = seal_ttl_for_reveal_deadline(reveal_deadline, now);
    let ttl = temporary_seal_ttl(&f, &seal_key(id, &bidder));
    assert!(
        ttl >= expected.saturating_sub(1),
        "seal TTL {ttl} should cover reveal window ({expected} ledgers)"
    );
    assert!(ttl >= TEMP_THRESHOLD);
    assert!(f.client.get_seal(&id, &bidder).is_some());
}

#[test]
fn open_reveal_extends_seal_through_reveal_window() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let bidder = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &bidder, 500, 1_000, 0x01);

    advance_ledgers(&f, TEMP_THRESHOLD);
    let ttl_before = temporary_seal_ttl(&f, &seal_key(id, &bidder));

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));

    let ttl_after = temporary_seal_ttl(&f, &seal_key(id, &bidder));
    let expected = seal_ttl_for_reveal_deadline(reveal_deadline, f.env.ledger().timestamp());
    assert!(
        ttl_after >= expected.saturating_sub(1),
        "open_reveal should re-extend seal TTL to {expected}, got {ttl_after}"
    );
    assert!(ttl_after >= ttl_before);
    assert!(f.client.get_seal(&id, &bidder).is_some());
}

#[test]
fn settled_round_persistent_state_survives_seal_expiry() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let nonce = commit_bid(&f, id, &alice, 700, 1_000, 0x11);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);

    let ttl = temporary_seal_ttl(&f, &seal_key(id, &alice));
    advance_ledgers(&f, ttl + 1);
    assert!(f.client.get_seal(&id, &alice).is_none(), "seal should expire after TTL");
    assert_eq!(f.client.get_round(&id).status, Status::Settled);
    assert_eq!(f.client.get_bid_state(&id, &alice).revealed_value, Some(700));
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

#[test]
fn voided_round_refunds_survive_seal_expiry() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let alice = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &alice, 500, 1_000, 0x01);

    let ttl = temporary_seal_ttl(&f, &seal_key(id, &alice));
    advance_ledgers(&f, ttl + 1);
    assert!(f.client.get_seal(&id, &alice).is_none());

    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_601);
    f.client.void(&id);
    assert_eq!(f.client.get_round(&id).status, Status::Voided);
    assert_eq!(f.usdc_token.balance(&alice), 1_000);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

#[test]
fn late_reveal_rejected_after_window_even_with_seal_present() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let nonce = commit_bid(&f, id, &alice, 700, 1_000, 0x11);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert!(f.client.get_seal(&id, &alice).is_some());

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert!(
        f.client.try_reveal(&id, &alice, &700, &nonce).is_err(),
        "late reveal must be rejected after reveal_deadline"
    );
    assert_eq!(f.client.get_bid_state(&id, &alice).revealed_value, None);
}

#[test]
fn clear_and_settle_work_after_seal_expiry() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let bob = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 700, 1_000, 0x11);
    let b_nonce = commit_bid(&f, id, &bob, 500, 1_000, 0x22);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &a_nonce);
    f.client.reveal(&id, &bob, &500, &b_nonce);

    let ttl = temporary_seal_ttl(&f, &seal_key(id, &alice));
    advance_ledgers(&f, ttl + 1);
    assert!(f.client.get_seal(&id, &alice).is_none());
    assert!(f.client.get_seal(&id, &bob).is_none());

    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(alice.clone()));
    f.client.settle(&id);
    assert_eq!(f.client.get_round(&id).status, Status::Settled);
    assert_eq!(f.usdc_token.balance(&operator), 700);
}

#[test]
fn observer_reads_round_and_bid_state_after_lifecycle_completion() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(&f, &operator, commit_deadline, reveal_deadline, ClearingRule::HighestBid);
    let alice = funded_bidder(&f, 1_000);
    let nonce = commit_bid(&f, id, &alice, 700, 1_000, 0x11);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &nonce);
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);

    let ttl = temporary_seal_ttl(&f, &seal_key(id, &alice));
    advance_ledgers(&f, ttl + 1);

    assert!(f.client.get_seal(&id, &alice).is_none());
    let round = f.client.get_round(&id);
    assert_eq!(round.status, Status::Settled);
    assert_eq!(round.winner, Some(alice.clone()));
    assert_eq!(round.winning_bid, 700);
    let state = f.client.get_bid_state(&id, &alice);    assert_eq!(state.revealed_value, Some(700));
    assert!(state.valid);
    assert!(state.settled);
}

// ─────────────────────────────────────────────────────────────────────────────
// ISSUE #374 — ESCROW CONSERVATION (partial reveal, void, settle)
//
// One predicate, proved by the contract on reveal, clear/void, and settle:
// committed escrow equals the settled payout plus refunds plus the balance still
// locked, and every locked dollar is backed by an unsettled bid in the round's
// bidder index. These tests pin both directions — the lifecycles that must stay
// allowed, and the mint / drop / double-pay paths that must fail.
// ─────────────────────────────────────────────────────────────────────────────

fn ledger(f: &Fixture, round_id: u64) -> EscrowLedger {
    f.env
        .as_contract(&f.client.address, || try_get_ledger(&f.env, round_id))
        .expect("escrow ledger must exist once escrow has been committed")
}

fn assert_conserved(f: &Fixture, round_id: u64, label: &str) {
    let l = ledger(f, round_id);
    assert!(
        conserved(l.committed, l.payout, l.refunds, l.locked),
        "{label}: committed {} != payout {} + refunds {} + locked {}",
        l.committed,
        l.payout,
        l.refunds,
        l.locked,
    );
}

/// Mutate the round record directly, standing in for any drift between the
/// bidder index a terminal path pays from and the set that was escrowed.
fn tamper_round(f: &Fixture, round_id: u64, mutate: impl FnOnce(&mut Round)) {
    f.env.as_contract(&f.client.address, || {
        let mut round = get_round(&f.env, round_id).unwrap();
        mutate(&mut round);
        set_round(&f.env, round_id, &round);
    });
}

/// Remove one address from the bidder index while leaving its escrow locked.
fn drop_bidder_from_index(f: &Fixture, round_id: u64, dropped: &Address) {
    f.env.as_contract(&f.client.address, || {
        let mut round = get_round(&f.env, round_id).unwrap();
        let mut kept = Vec::new(&f.env);
        for bidder in round.bidders.iter() {
            if bidder != *dropped {
                kept.push_back(bidder);
            }
        }
        round.bidders = kept;
        set_round(&f.env, round_id, &round);
    });
}

/// Flag a bid as already settled without paying it.
fn mark_settled(f: &Fixture, round_id: u64, bidder: &Address) {
    f.env.as_contract(&f.client.address, || {
        let mut state: BidState = get_state(&f.env, round_id, bidder).unwrap();
        state.settled = true;
        set_state(&f.env, round_id, bidder, &state);
    });
}

#[test]
fn conservation_predicate_table_driven() {
    // (committed, payout, refunds, locked, expected)
    let cases: &[(i128, i128, i128, i128, bool)] = &[
        (0, 0, 0, 0, true),             // nothing committed, nothing moved
        (1_200, 0, 0, 1_200, true),     // open round: every escrow locked
        (1_200, 700, 500, 0, true),     // settled: payout + refunds drain escrow
        (1_200, 200, 1_000, 0, true),   // voided: refunds drain escrow
        (1_200, 700, 500, 100, false),  // drop: escrow still locked after settlement
        (1_200, 1_300, 0, 0, false),    // mint: paid out more than was committed
        (1_200, 1_200, 0, 0, true),     // the whole escrow can go to the operator
        (1_200, 700, 400, 0, false),    // drop: refunds short of committed - payout
        (1_200, 700, 700, 0, false),    // mint: refunds exceed the escrow held
        (0, 0, 100, 0, false),          // refunds with nothing ever committed
        (1_200, -700, 1_900, 0, false), // a negative flow is not conservation
        (1_200, 700, 500, -1, false),   // refunded past the locked balance
    ];
    for (i, (committed, payout, refunds, locked, expected)) in cases.iter().enumerate() {
        assert_eq!(
            conserved(*committed, *payout, *refunds, *locked),
            *expected,
            "case {}: conserved({committed}, {payout}, {refunds}, {locked})",
            i,
        );
    }
}

#[test]
fn escrow_ledger_tracks_commits_overwrites_and_settlement() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let alice = funded_bidder(&f, 2_000);
    let bob = funded_bidder(&f, 2_000);

    commit_bid(&f, id, &alice, 700, 900, 0x01);
    assert_eq!(
        (ledger(&f, id).committed, ledger(&f, id).locked),
        (900, 900),
        "one commit locks exactly its escrow"
    );

    // Overwrite before close: the returned escrow is a refund, and `committed`
    // stays cumulative so the identity keeps holding.
    let a_nonce = commit_bid(&f, id, &alice, 700, 700, 0x02);
    let b_nonce = commit_bid(&f, id, &bob, 400, 1_000, 0x03);
    let l = ledger(&f, id);
    assert_eq!(
        (l.committed, l.refunds, l.locked),
        (2_600, 900, 1_700),
        "900 + 700 + 1_000 committed, the 900 overwritten escrow returned"
    );
    assert_conserved(&f, id, "after commits with an overwrite");

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &700, &a_nonce);
    f.client.reveal(&id, &bob, &400, &b_nonce);
    assert_conserved(&f, id, "during reveal");

    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);
    f.client.settle(&id);

    let settled = ledger(&f, id);
    assert_eq!(
        (
            settled.committed,
            settled.payout,
            settled.refunds,
            settled.locked
        ),
        (2_600, 700, 1_900, 0),
        "operator takes the 700 bid, both surplus and loser's escrow come back"
    );
    assert_conserved(&f, id, "after settle");
    assert_eq!(f.usdc_token.balance(&operator), 700);
    assert_eq!(
        f.usdc_token.balance(&alice),
        1_300,
        "700 surplus plus 600 never escrowed"
    );
    assert_eq!(
        f.usdc_token.balance(&bob),
        2_000,
        "the loser's escrow came back in full"
    );
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

#[test]
fn partial_reveal_refunds_every_unrevealed_bidder_exactly_once() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 700);
    let silent = funded_bidder(&f, 300);
    let quiet = funded_bidder(&f, 200);
    let w_nonce = commit_bid(&f, id, &winner, 500, 700, 0x01);
    commit_bid(&f, id, &silent, 999, 300, 0x02);
    commit_bid(&f, id, &quiet, 888, 200, 0x03);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    // One of three bids reveals; the two larger unrevealed bids must be
    // refunded in full rather than settled against.
    f.client.reveal(&id, &winner, &500, &w_nonce);
    assert_conserved(&f, id, "one bid of three revealed");

    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(winner.clone()));
    assert_conserved(&f, id, "after clearing a partially revealed round");

    f.client.settle(&id);
    let settled = ledger(&f, id);
    assert_eq!(
        (
            settled.committed,
            settled.payout,
            settled.refunds,
            settled.locked
        ),
        (1_200, 500, 700, 0),
        "only the revealed winner pays; everyone else is made whole"
    );
    assert_conserved(&f, id, "after settling a partially revealed round");

    assert_eq!(
        f.usdc_token.balance(&operator),
        500,
        "operator takes the winning bid"
    );
    assert_eq!(
        f.usdc_token.balance(&winner),
        200,
        "winner surplus of 200 over a 500 bid"
    );
    assert_eq!(
        f.usdc_token.balance(&silent),
        300,
        "unrevealed bidder refunded once"
    );
    assert_eq!(
        f.usdc_token.balance(&quiet),
        200,
        "unrevealed bidder refunded once"
    );
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        0,
        "no escrow stranded"
    );

    for bidder in [winner, silent, quiet] {
        let state = f.client.get_bid_state(&id, &bidder);
        assert!(state.settled, "each bid is marked settled exactly once");
    }
}

#[test]
fn zero_revealed_bids_void_refunds_every_bidder_exactly_once() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let a = funded_bidder(&f, 1_000);
    let b = funded_bidder(&f, 1_000);
    let c = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &a, 700, 700, 0x01);
    commit_bid(&f, id, &b, 500, 500, 0x02);
    commit_bid(&f, id, &c, 300, 300, 0x03);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    assert_conserved(&f, id, "reveal open with zero reveals");

    // Nobody reveals, so clearing voids the round and refunds the whole round.
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), None);
    let settled = ledger(&f, id);
    assert_eq!(
        (
            settled.committed,
            settled.payout,
            settled.refunds,
            settled.locked
        ),
        (1_500, 0, 1_500, 0),
        "a void refunds every escrow and pays nobody"
    );
    assert_conserved(&f, id, "after voiding an unrevealed round");

    assert_eq!(f.usdc_token.balance(&operator), 0, "a void pays nobody");
    assert_eq!(f.usdc_token.balance(&a), 1_000);
    assert_eq!(f.usdc_token.balance(&b), 1_000);
    assert_eq!(f.usdc_token.balance(&c), 1_000);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);

    // Refunds are exactly once: a second attempt is rejected, not repeated.
    assert_try_contract_err(f.client.try_clear(&id), Error::RoundVoided);
    assert_try_contract_err(f.client.try_settle(&id), Error::RoundVoided);
    assert_eq!(f.usdc_token.balance(&a), 1_000, "no second refund");
    assert_eq!(f.usdc_token.balance(&b), 1_000, "no second refund");
    assert_eq!(f.usdc_token.balance(&c), 1_000, "no second refund");
}

#[test]
fn empty_round_conserves_escrow_on_void_and_settle_paths() {
    // A round nobody bid on: zero escrow, zero revealed, zero refunded.
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), None);
    assert_conserved(&f, id, "empty round voided through clear");
    let l = ledger(&f, id);
    assert_eq!((l.committed, l.payout, l.refunds, l.locked), (0, 0, 0, 0));
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.client.get_round(&id).status, Status::Voided);

    // The explicit liveness valve on an untouched round behaves the same way.
    let f2 = setup();
    let operator2 = Address::generate(&f2.env);
    let id2 = open_round(&f2, &operator2);
    f2.env
        .ledger()
        .with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f2.client.void(&id2);
    assert_conserved(&f2, id2, "empty round voided through void");
    assert_eq!(f2.usdc_token.balance(&f2.client.address), 0);
}

/// Many revealed bids behind several bidder pages: conservation is per-round,
/// not per-page, so walking the index in pages must not change the outcome.
#[test]
fn many_bidders_across_multiple_pages_settle_conserving_escrow() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    // Escrows 100, 150, …, 400 → 1_750 committed. Bidder 3 bids its full escrow.
    // Each bidder is funded with exactly its escrow, so its final balance is
    // exactly what the round paid back to it.
    let mut bidders = Vec::new(&f.env);
    let mut nonces = Vec::new(&f.env);
    let mut escrows = Vec::new(&f.env);
    for i in 0..7u8 {
        let escrow = 100 + i as i128 * 50;
        let bidder = funded_bidder(&f, escrow);
        let bid = if i == 3 { escrow } else { 10 + i as i128 };
        nonces.push_back(commit_bid(&f, id, &bidder, bid, escrow, i + 1));
        bidders.push_back(bidder);
        escrows.push_back(escrow);
    }
    assert_conserved(&f, id, "after seven commits");

    // Walk the bidder index in three pages; the pages must agree with the full
    // list and report a stable total before anything is revealed.
    let mut paged: Vec<Address> = Vec::new(&f.env);
    let mut cursor: u32 = 0;
    loop {
        let page = f.client.get_bidders_page(&id, &cursor, &3);
        assert_eq!(
            page.total, 7,
            "the reported total must not change between reads"
        );
        for i in 0..page.data.len() {
            paged.push_back(page.data.get(i).unwrap());
        }
        if page.next_cursor == 0 {
            break;
        }
        cursor = page.next_cursor;
    }
    assert_eq!(paged.len(), 7);
    for i in 0..7 {
        assert_eq!(paged.get(i).unwrap(), bidders.get(i).unwrap());
    }

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    // Four of seven reveal; the remaining three must be refunded in full.
    for i in 0..4u32 {
        let bid = if i == 3 {
            escrows.get(i).unwrap()
        } else {
            10 + i as i128
        };
        f.client
            .reveal(&id, &bidders.get(i).unwrap(), &bid, &nonces.get(i).unwrap());
    }
    assert_conserved(&f, id, "during a partial reveal over several pages");

    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(
        f.client.clear(&id),
        Some(bidders.get(3).unwrap()),
        "index 3 bid its full escrow"
    );
    assert_conserved(&f, id, "after clear");

    f.client.settle(&id);
    let settled = ledger(&f, id);
    assert_eq!(
        (
            settled.committed,
            settled.payout,
            settled.refunds,
            settled.locked
        ),
        (1_750, 250, 1_500, 0),
        "payout plus every loser's escrow, nothing left locked",
    );
    assert_conserved(&f, id, "after settling a multi-page round");
    assert_eq!(f.usdc_token.balance(&operator), 250);
    for i in 0..7u32 {
        let expected = if i == 3 { 0 } else { escrows.get(i).unwrap() };
        assert_eq!(
            f.usdc_token.balance(&bidders.get(i).unwrap()),
            expected,
            "bidder {i} was refunded exactly what it escrowed",
        );
    }
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

// ── Conservation failures: mint, drop, double-pay ───────────────────────────

#[test]
fn settle_rejects_dropped_bidder_instead_of_stranding_escrow() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 500);
    let loser = funded_bidder(&f, 400);
    let w_nonce = commit_bid(&f, id, &winner, 500, 500, 0x01);
    commit_bid(&f, id, &loser, 400, 400, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &winner, &500, &w_nonce);
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(winner.clone()));

    // The loser's escrow is locked but their address left the index — settling
    // the visible set would drop 400 USDC in the contract forever.
    drop_bidder_from_index(&f, id, &loser);
    assert_try_contract_err(f.client.try_settle(&id), Error::EscrowNotConserved);
    assert_eq!(
        f.usdc_token.balance(&operator),
        0,
        "no payout on a dropped escrow"
    );
    assert_eq!(
        f.usdc_token.balance(&loser),
        0,
        "the dropped escrow was not returned"
    );
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        900,
        "every escrow stays locked"
    );
    assert_eq!(
        f.client.get_round(&id).status,
        Status::Cleared,
        "the settle did not land"
    );
}

#[test]
fn settle_rejects_double_pay_from_a_duplicated_bidder_index() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 500);
    let loser = funded_bidder(&f, 400);
    let w_nonce = commit_bid(&f, id, &winner, 500, 500, 0x01);
    commit_bid(&f, id, &loser, 400, 400, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &winner, &500, &w_nonce);
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);

    // The loser appears twice, so paying the index would refund 400 twice.
    tamper_round(&f, id, |round| round.bidders.push_back(loser.clone()));
    assert_try_contract_err(f.client.try_settle(&id), Error::EscrowNotConserved);
    assert_eq!(
        f.usdc_token.balance(&loser),
        0,
        "no refund and no double refund"
    );
    assert_eq!(
        f.usdc_token.balance(&operator),
        0,
        "no payout on a double-pay path"
    );
    assert_eq!(f.usdc_token.balance(&f.client.address), 900);
}

#[test]
fn settle_rejects_mint_when_the_ledger_claims_more_escrow_than_bids_hold() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 700);
    let w_nonce = commit_bid(&f, id, &winner, 500, 700, 0x01);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &winner, &500, &w_nonce);
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);

    // Claim 100 more escrow than any bid holds: the arithmetic identity still
    // holds, but the locked balance is not backed by the bidder index.
    f.env.as_contract(&f.client.address, || {
        let mut l = try_get_ledger(&f.env, id).unwrap();
        l.committed += 100;
        l.locked += 100;
        crate::storage::set_ledger(&f.env, id, &l);
    });
    assert_try_contract_err(f.client.try_settle(&id), Error::EscrowNotConserved);
    assert_eq!(f.usdc_token.balance(&operator), 0);
    assert_eq!(f.usdc_token.balance(&winner), 0, "winner surplus untouched");
    assert_eq!(f.usdc_token.balance(&f.client.address), 700);
}

#[test]
fn settle_rejects_bid_already_marked_settled() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 1_000);
    let loser = funded_bidder(&f, 1_000);
    let w_nonce = commit_bid(&f, id, &winner, 500, 500, 0x01);
    commit_bid(&f, id, &loser, 400, 400, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &winner, &500, &w_nonce);
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);

    // A payout that already ran would leave the loser marked settled with escrow
    // still locked, so the settle must refuse rather than double-spend the round.
    mark_settled(&f, id, &loser);
    assert_try_contract_err(f.client.try_settle(&id), Error::EscrowNotConserved);
    assert_eq!(
        f.usdc_token.balance(&loser),
        600,
        "no refund through a settled flag"
    );
    assert_eq!(f.usdc_token.balance(&f.client.address), 900);
}

#[test]
fn reveal_rejects_a_bidder_index_that_drifted_from_the_escrowed_set() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let alice = funded_bidder(&f, 1_000);
    let bob = funded_bidder(&f, 1_000);
    let carol = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);
    let c_nonce = commit_bid(&f, id, &carol, 450, 450, 0x02);
    commit_bid(&f, id, &bob, 400, 400, 0x03);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &alice, &500, &a_nonce);
    assert_conserved(&f, id, "before the index drifts");

    // Drop an escrow-bearing bidder mid-reveal: the remaining reveal set no
    // longer matches what escrow was taken against.
    drop_bidder_from_index(&f, id, &bob);
    assert_try_contract_err(
        f.client.try_reveal(&id, &carol, &450, &c_nonce),
        Error::EscrowNotConserved,
    );
    assert_eq!(
        f.client.get_bid_state(&id, &carol).revealed_value,
        None,
        "a reveal against an unreconcilable round must not be recorded"
    );
    assert_eq!(f.client.get_round(&id).status, Status::Revealing);
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        1_350,
        "all escrow still locked"
    );
}

#[test]
fn reveal_rejects_a_phantom_bidder_in_the_index() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let alice = funded_bidder(&f, 1_000);
    let a_nonce = commit_bid(&f, id, &alice, 500, 500, 0x01);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));

    // An address with no escrowed bid cannot be revealed for, and its presence
    // makes the round unaccountable for.
    let phantom = funded_bidder(&f, 1_000);
    tamper_round(&f, id, |round| round.bidders.push_back(phantom.clone()));
    assert_try_contract_err(
        f.client.try_reveal(&id, &alice, &500, &a_nonce),
        Error::EscrowNotConserved,
    );
    assert_eq!(f.client.get_bid_state(&id, &alice).revealed_value, None);
    assert_eq!(f.usdc_token.balance(&f.client.address), 500);
}

#[test]
fn void_rejects_a_bidder_index_that_drifted_from_the_escrowed_set() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let a = funded_bidder(&f, 1_000);
    let b = funded_bidder(&f, 1_000);
    commit_bid(&f, id, &a, 700, 700, 0x01);
    commit_bid(&f, id, &b, 500, 500, 0x02);

    // A bidder whose escrow is locked is missing from the index: refunding the
    // visible set would strand their USDC, so the void is refused.
    drop_bidder_from_index(&f, id, &b);
    f.env.ledger().with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    assert_try_contract_err(f.client.try_void(&id), Error::EscrowNotConserved);
    assert_eq!(
        f.client.get_round(&id).status,
        Status::Open,
        "the void did not land"
    );
    assert_eq!(
        f.usdc_token.balance(&a),
        300,
        "no partial refund through a refused void"
    );
    assert_eq!(f.usdc_token.balance(&b), 500);
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        1_200,
        "every escrow stays locked"
    );
}

#[test]
fn settle_works_again_after_the_index_is_restored() {
    let (f, t_reveal, commit_deadline, reveal_deadline) = setup_drand();
    let operator = Address::generate(&f.env);
    let id = drand_round(
        &f,
        &operator,
        commit_deadline,
        reveal_deadline,
        ClearingRule::HighestBid,
    );

    let winner = funded_bidder(&f, 500);
    let loser = funded_bidder(&f, 400);
    let w_nonce = commit_bid(&f, id, &winner, 500, 500, 0x01);
    commit_bid(&f, id, &loser, 400, 400, 0x02);

    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    f.client.open_reveal(&id, &real_sig(&f.env));
    f.client.reveal(&id, &winner, &500, &w_nonce);
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = reveal_deadline + 1);
    f.client.clear(&id);

    drop_bidder_from_index(&f, id, &loser);
    assert_try_contract_err(f.client.try_settle(&id), Error::EscrowNotConserved);
    tamper_round(&f, id, |round| round.bidders.push_back(loser.clone()));
    f.client.settle(&id);

    assert_conserved(&f, id, "after settling a repaired round");
    assert_eq!(f.usdc_token.balance(&operator), 500);
    assert_eq!(f.usdc_token.balance(&winner), 0);
    assert_eq!(
        f.usdc_token.balance(&loser),
        400,
        "the repaired index refunds the loser"
    );
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// ISSUE #160 — ERROR CODE DOCUMENTATION CONSISTENCY
//
// These tests make sure contracts/round/ERRORS.md never drifts away from the
// exported enum Error in src/types.rs. Two complementary guards:
//
//   1. `variant_name` is a non-exhaustive-friendly match — adding, renaming, or
//      removing a variant in `src/types.rs` will fail to compile here. That is
//      the strongest guard.
//
//   2. `DOCUMENTED_ERROR_CODES` mirrors the same set of variants with their
//      runtime discriminants; the assertions below catch any silent reordering
//      or renumbering that does not change the variant list.
//
// Whenever you change the `Error` enum, update `contracts/round/ERRORS.md`,
// `DOCUMENTED_ERROR_CODES`, and `variant_name` in lock-step.
// ─────────────────────────────────────────────────────────────────────────────

/// Authoritative (name, code) mapping for every variant of [`Error`]. Keep in
/// sync with `contracts/round/ERRORS.md`.
pub(super) const DOCUMENTED_ERROR_CODES: &[(Error, u32)] = &[
    // ── 1–4: initialization & lookup ──
    (Error::NotInitialized, 1),
    (Error::AlreadyInitialized, 2),
    (Error::RoundNotFound, 3),
    (Error::BidNotFound, 4),
    // ── 10–22: lifecycle & timing ──
    (Error::CommitClosed, 10),
    (Error::CommitNotClosed, 11),
    (Error::CommitDeadlineAfterReveal, 12),
    (Error::RevealNotOpen, 13),
    (Error::RevealAlreadyOpen, 14),
    (Error::RevealWindowClosed, 15),
    (Error::RevealStillOpen, 16),
    (Error::NotCleared, 17),
    (Error::AlreadyCleared, 18),
    (Error::AlreadySettled, 19),
    (Error::RoundVoided, 20),
    (Error::NotVoidable, 21),
    (Error::WrongStatus, 22),
    // ── 30–40: cryptography & validation ──
    (Error::InvalidDrandSignature, 30),
    (Error::HashMismatch, 31),
    (Error::AlreadyRevealed, 32),
    (Error::PayloadTooLarge, 33),
    (Error::InvalidAmount, 34),
    (Error::BidExceedsEscrow, 35),
    (Error::DeadlineInPast, 36),
    (Error::NoValidBids, 37),
    (Error::RoundFull, 38),
    (Error::InvalidLimit, 39),
    // ── 40–49: escrow accounting ──
    (Error::EscrowNotConserved, 40),
];

/// Convert an `Error` to its on-chain discriminant using the [`repr(u32)`]
/// representation declared in `src/types.rs`. This is the same value that is
/// embedded in `soroban_sdk::Error::Contract(...)` instances seen by callers.
pub(super) fn discriminant(e: Error) -> u32 {
    e as u32
}

pub(super) fn variant_name(e: Error) -> &'static str {
    match e {
        Error::NotInitialized => "NotInitialized",
        Error::AlreadyInitialized => "AlreadyInitialized",
        Error::RoundNotFound => "RoundNotFound",
        Error::BidNotFound => "BidNotFound",
        Error::CommitClosed => "CommitClosed",
        Error::CommitNotClosed => "CommitNotClosed",
        Error::CommitDeadlineAfterReveal => "CommitDeadlineAfterReveal",
        Error::RevealNotOpen => "RevealNotOpen",
        Error::RevealAlreadyOpen => "RevealAlreadyOpen",
        Error::RevealWindowClosed => "RevealWindowClosed",
        Error::RevealStillOpen => "RevealStillOpen",
        Error::NotCleared => "NotCleared",
        Error::AlreadyCleared => "AlreadyCleared",
        Error::AlreadySettled => "AlreadySettled",
        Error::RoundVoided => "RoundVoided",
        Error::NotVoidable => "NotVoidable",
        Error::WrongStatus => "WrongStatus",
        Error::InvalidDrandSignature => "InvalidDrandSignature",
        Error::HashMismatch => "HashMismatch",
        Error::AlreadyRevealed => "AlreadyRevealed",
        Error::PayloadTooLarge => "PayloadTooLarge",
        Error::InvalidAmount => "InvalidAmount",
        Error::BidExceedsEscrow => "BidExceedsEscrow",
        Error::DeadlineInPast => "DeadlineInPast",
        Error::NoValidBids => "NoValidBids",
        Error::RoundFull => "RoundFull",
        Error::InvalidLimit => "InvalidLimit",
        Error::EscrowNotConserved => "EscrowNotConserved",
    }
}

#[test]
fn error_discriminants_match_document() {
    for (variant, expected_code) in DOCUMENTED_ERROR_CODES {
        let actual = discriminant(*variant);
        assert_eq!(
            actual, *expected_code,
            "{} discriminant drifted (got {}, expected {}) — update \
             contracts/round/ERRORS.md and DOCUMENTED_ERROR_CODES together",
            variant_name(*variant),
            actual,
            expected_code,
        );
    }
}

#[test]
fn error_codes_have_no_duplicate_discriminants() {
    // O(n²) is fine: n = 28. Done without `std::collections` because the
    // contract's `#![no_std]` applies to this module.
    for (i, (variant_a, code_a)) in DOCUMENTED_ERROR_CODES.iter().enumerate() {
        let name_a = variant_name(*variant_a);
        for (variant_b, code_b) in DOCUMENTED_ERROR_CODES.iter().skip(i + 1) {
            if code_a == code_b {
                let name_b = variant_name(*variant_b);
                panic!(
                    "duplicate discriminant {code_a}: both {name_a} and {name_b} claim it. \
                     Two variants must not share an on-chain code."
                );
            }
        }
    }
}

#[test]
fn error_table_enumerates_every_variant() {
    // Maintenance hint: this test pins the *count* of variants in
    // DOCUMENTED_ERROR_CODES. The stronger parity guard is compile-time:
    // `variant_name` exhaustively matches every variant of `enum Error`, so
    // adding, removing, or renaming a variant fails to compile here. This
    // test just documents the expected scale and catches the sneakier case
    // where someone adds a variant AND a `variant_name` arm without updating
    // DOCUMENTED_ERROR_CODES.
    assert_eq!(
        DOCUMENTED_ERROR_CODES.len(),
        28,
        "DOCUMENTED_ERROR_CODES appears missing entries. The exhaustive \
         `variant_name` match already enforces parity at compile time — \
         update it together with this list and contracts/round/ERRORS.md."
    );
}

#[test]
fn error_codes_use_reserved_ranges() {
    // Range policy enforced by the documentation:
    //   1–4     → initialization/lookup
    //   10–22   → lifecycle/timing
    //   30–39   → crypto/validation
    //   40–49   → escrow accounting
    // New categories should pick a fresh, contiguous range — not collide with
    // logging conventions — and update ERRORS.md at the same time.
    for (variant, code) in DOCUMENTED_ERROR_CODES {
        let name = variant_name(*variant);
        let in_range = matches!(*code, 1..=4 | 10..=22 | 30..=39 | 40..=49);
        assert!(
            in_range,
            "{name} = {code} falls outside the documented code ranges; \
             update contracts/round/ERRORS.md if you intentionally added a new category"
        );
    }
}

fn shared_pagination_round() -> (Fixture, u64, Vec<Address>) {
    let f = setup();
    let id = open_round(&f, &Address::generate(&f.env));
    let mut bidders = Vec::new(&f.env);
    for (i, line) in include_str!("../../../fixtures/bidder-pagination.txt")
        .lines()
        .enumerate()
    {
        let bidder = Address::from_string(&soroban_sdk::String::from_str(&f.env, line));
        f.usdc_admin.mint(&bidder, &1000);
        f.client.commit(
            &id,
            &bidder,
            &b32(&f.env, i as u8),
            &Bytes::from_array(&f.env, b"c"),
            &100,
            &Bytes::new(&f.env),
        );
        bidders.push_back(bidder);
    }
    (f, id, bidders)
}

#[test]
fn bidder_cursor_shared_fixture_three_pages() {
    let (f, id, expected) = shared_pagination_round();
    let mut cursor = None;
    let mut all = Vec::new(&f.env);
    let mut pages = 0;
    loop {
        let page = f.client.get_bidders_page(&id, &cursor, &3);
        pages += 1;
        assert_eq!(page.total, expected.len());
        for bidder in page.data.iter() {
            all.push_back(bidder);
        }
        if !page.has_more {
            assert!(page.next_cursor.is_none());
            break;
        }
        cursor = page.next_cursor;
    }
    assert_eq!(pages, 3);
    assert_eq!(all, expected);
}

#[test]
fn bidder_cursor_rejects_tampering_and_foreign_scope() {
    let (f, id, _) = shared_pagination_round();
    let cursor = f
        .client
        .get_bidders_page(&id, &None, &3)
        .next_cursor
        .unwrap();
    // Every token byte is covered, including the version, offset, and count.
    for i in 0..cursor.len() {
        let mut tampered = cursor.clone();
        tampered.set(i, tampered.get(i).unwrap() ^ 1);
        assert_try_contract_err(
            f.client.try_get_bidders_page(&id, &Some(tampered), &3),
            Error::InvalidCursor,
        );
    }
    for len in [0, 1, 40, 42] {
        assert_try_contract_err(
            f.client.try_get_bidders_page(
                &id,
                &Some(Bytes::from_slice(&f.env, &[1; 42][..len])),
                &3,
            ),
            Error::InvalidCursor,
        );
    }
    let other_id = open_round(&f, &Address::generate(&f.env));
    assert_try_contract_err(
        f.client
            .try_get_bidders_page(&other_id, &Some(cursor.clone()), &3),
        Error::InvalidCursor,
    );
    let other = f.env.register(
        SubRosaRound,
        (
            BytesN::from_array(&f.env, &[0u8; 192]),
            BytesN::from_array(&f.env, &[0u8; 192]),
            Bytes::new(&f.env),
            GENESIS,
            PERIOD,
            f.usdc_token.address.clone(),
        ),
    );
    f.env.as_contract(&other, || {
        let round = f.env.as_contract(&f.client.address, || {
            crate::storage::get_round(&f.env, id).unwrap()
        });
        crate::storage::set_round(&f.env, id, &round);
    });
    assert_try_contract_err(
        SubRosaRoundClient::new(&f.env, &other).try_get_bidders_page(&id, &Some(cursor), &3),
        Error::InvalidCursor,
    );
}

#[test]
fn bidder_cursor_snapshot_survives_append_and_overwrite() {
    let (f, id, expected) = shared_pagination_round();
    let first = f.client.get_bidders_page(&id, &None, &3);
    let newcomer = funded_bidder(&f, 1000);
    for bidder in [newcomer, expected.get(0).unwrap()] {
        f.client.commit(
            &id,
            &bidder,
            &b32(&f.env, 9),
            &Bytes::from_array(&f.env, b"c"),
            &100,
            &Bytes::new(&f.env),
        );
    }
    let second = f.client.get_bidders_page(&id, &first.next_cursor, &3);
    let third = f.client.get_bidders_page(&id, &second.next_cursor, &3);
    assert_eq!(third.total, 7);
    assert_eq!(third.data.len(), 1);
    assert_eq!(third.data.get(0), expected.get(6));
    assert!(!third.has_more);
    assert_eq!(f.client.get_bidders_page(&id, &None, &100).total, 8);
}
