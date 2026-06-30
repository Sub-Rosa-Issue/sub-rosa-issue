use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Vec};

/// Contract error codes. Every failure state from the PRD has a defined code —
/// there is no undefined behavior and no silent fallback.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    RoundNotFound = 3,
    BidNotFound = 4,
    // Lifecycle / timing
    CommitClosed = 10,
    CommitNotClosed = 11,
    CommitDeadlineAfterReveal = 12,
    RevealNotOpen = 13,
    RevealAlreadyOpen = 14,
    RevealWindowClosed = 15,
    RevealStillOpen = 16,
    NotCleared = 17,
    AlreadyCleared = 18,
    AlreadySettled = 19,
    RoundVoided = 20,
    NotVoidable = 21,
    WrongStatus = 22,
    // Crypto / validation
    InvalidDrandSignature = 30,
    HashMismatch = 31,
    AlreadyRevealed = 32,
    PayloadTooLarge = 33,
    InvalidAmount = 34,
    BidExceedsEscrow = 35,
    DeadlineInPast = 36,
    NoValidBids = 37,
    RoundFull = 38,
    InvalidLimit = 39,
}

/// Round lifecycle. Mirrors the state machine in PRD §6.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    Revealing,
    Cleared,
    Settled,
    Voided,
}

/// Deterministic clearing rule. Default is a first-price sealed-bid auction
/// (highest valid revealed bid wins).
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClearingRule {
    HighestBid,
    LowestBid,
}

/// Contract-global configuration, set once at deploy in Instance storage.
///
/// All Drand parameters are supplied at deploy time (validated against a live
/// quicknet round before deploy) so the source carries no guessed constants.
/// `drand_pubkey` and `g2_neg_generator` are uncompressed BLS12-381 G2 points
/// (192 bytes each) in Soroban host serialization. `dst` is the RFC 9380
/// domain separation tag for the configured Drand scheme.
#[contracttype]
#[derive(Clone)]
pub struct GlobalConfig {
    pub drand_pubkey: BytesN<192>,
    pub g2_neg_generator: BytesN<192>,
    pub dst: Bytes,
    pub drand_genesis: u64,
    pub drand_period: u64,
    pub usdc: Address,
}

/// Per-round record (Persistent). Survives until the round is explicitly closed.
#[contracttype]
#[derive(Clone)]
pub struct Round {
    pub operator: Address,
    /// Opaque reference to the item / allocation being decided (hash of an
    /// off-chain description). The contract is agnostic to its meaning.
    pub item_ref: BytesN<32>,
    /// Drand round number R whose threshold signature unseals the bids.
    pub reveal_round: u64,
    pub clearing_rule: ClearingRule,
    /// Unix seconds. Must be strictly before time(R).
    pub commit_deadline: u64,
    /// Unix seconds. Reveal window closes here; must be after time(R).
    pub reveal_deadline: u64,
    /// Public key bidder-identity blobs are encrypted to (selective disclosure).
    pub auditor_pubkey: Bytes,
    pub status: Status,
    pub bidders: Vec<Address>,
    pub winner: Option<Address>,
    pub winning_bid: i128,
}

/// Per-bid durable state (Persistent). Holds everything required to clear and
/// settle / refund safely, even if the ephemeral ciphertext has expired.
#[contracttype]
#[derive(Clone)]
pub struct BidState {
    /// H = sha256(be16(value) ‖ nonce) — binds the sealed bid.
    pub commitment: BytesN<32>,
    /// Public USDC budget locked at commit; upper bound on the sealed bid.
    pub escrow: i128,
    pub revealed_value: Option<i128>,
    /// The 32-byte nonce used in the commitment. Persisted at reveal time so
    /// that offline receipt verifiers can recompute sha256(be16(value)‖nonce)
    /// without trusting the exporter.
    pub revealed_nonce: Option<BytesN<32>>,
    pub valid: bool,
    pub settled: bool,
}

/// Per-bid ephemeral sealed payload (Temporary). Auto-expires after the reveal
/// window; the auto-expiry is the design, not a workaround (PRD §8).
#[contracttype]
#[derive(Clone)]
pub struct Seal {
    /// C = tlock_encrypt(be16(value) ‖ nonce, drand_pubkey, R).
    pub ciphertext: Bytes,
    /// enc(bidder_identity, auditor_pubkey) — readable only by the auditor.
    pub auditor_blob: Bytes,
}

/// A page of bidders for a round, with continuation metadata.
#[contracttype]
#[derive(Clone)]
pub struct BiddersPage {
    /// Page of bidder addresses.
    pub data: Vec<Address>,
    /// Cursor for the next page (0 if no more pages).
    pub next_cursor: u32,
    /// Total number of bidders in the round.
    pub total: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    RoundCounter,
    Round(u64),
    State(u64, Address),
    Seal(u64, Address),
}
