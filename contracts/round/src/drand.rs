use soroban_sdk::{
    crypto::bls12_381::{G1Affine, G2Affine},
    Bytes, BytesN, Env, Vec,
};

use crate::types::GlobalConfig;

/// Verify a Drand `round` threshold signature on-chain.
///
/// Sub Rosa uses the Drand "unchained" scheme on BLS12-381 with signatures on
/// G1 and the network public key on G2 (`bls-unchained-g1-rfc9380`). For round
/// R the signed message is `sha256(be8(R))`, hashed to G1 with the network DST.
///
/// Standard BLS verification checks `e(H, pk) == e(sig, g2_generator)`, which we
/// express as a single product-of-pairings equal to the identity:
///
/// ```text
///   e(sig, -g2_generator) · e(H, pk) == 1
/// ```
///
/// `pairing_check` returns true iff that product is the identity. This is the
/// single, trustless proof that Drand round R has been produced — it is the gate
/// that unlocks the reveal window. There is no operator override and no fallback.
///
/// `signature` is the uncompressed G1 point (96 bytes) for round R. The negated
/// G2 generator and the network public key / DST come from `GlobalConfig`, set
/// at deploy from values validated against a live quicknet round.
pub fn verify_round(env: &Env, config: &GlobalConfig, round: u64, signature: &BytesN<96>) -> bool {
    let bls = env.crypto().bls12_381();

    // message = sha256(be8(round))
    let mut round_bytes = Bytes::new(env);
    round_bytes.extend_from_array(&round.to_be_bytes());
    let digest = env.crypto().sha256(&round_bytes).to_bytes();
    let mut message = Bytes::new(env);
    message.extend_from_array(&digest.to_array());

    // H = hash_to_g1(message, DST)
    let h: G1Affine = bls.hash_to_g1(&message, &config.dst);

    let sig = G1Affine::from_bytes(signature.clone());
    let pk = G2Affine::from_bytes(config.drand_pubkey.clone());
    let neg_g2 = G2Affine::from_bytes(config.g2_neg_generator.clone());

    let g1_points = Vec::from_array(env, [sig, h]);
    let g2_points = Vec::from_array(env, [neg_g2, pk]);

    bls.pairing_check(g1_points, g2_points)
}

/// Wall-clock time (unix seconds) at which Drand round `round` is published.
///
/// Saturating arithmetic: an absurdly large `round` clamps to `u64::MAX`, which
/// `create_round` then rejects via its deadline checks rather than panicking.
pub fn time_of_round(config: &GlobalConfig, round: u64) -> u64 {
    config
        .drand_genesis
        .saturating_add(config.drand_period.saturating_mul(round))
}
