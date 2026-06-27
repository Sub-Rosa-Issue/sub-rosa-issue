//   Copyright 2024 The Sub Rosa Contributors
//   SPDX-License-Identifier: Apache-2.0

//! Storage expiration and cleanup utilities.
//!
//! Audits current storage keys, documents TTL behavior, and provides
//! helpers for explicit storage lifetime management in production.

use soroban_sdk::{Env, Symbol};

/// Storage key categories and their expected TTL behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageKind {
    /// Round metadata: persists for the full round lifecycle.
    RoundMetadata,
    /// Sealed bidder blobs: temporary, should expire after reveal phase.
    SealerBlob,
    /// Settlement receipts: persistent, needed for audit.
    SettlementReceipt,
    /// Keeper state: ephemeral, can be cleaned after settlement.
    KeeperState,
}

impl StorageKind {
    /// Returns true if this storage kind should be explicitly cleaned
    /// after the round is settled.
    pub fn should_cleanup_after_settlement(&self) -> bool {
        matches!(self, Self::SealerBlob | Self::KeeperState)
    }

    /// Expected lifetime in ledger sequences (0 = indefinite).
    pub fn expected_ttl_ledgers(&self) -> u32 {
        match self {
            Self::SealerBlob  => 100_000,   // ~7 days at 5s ledger time
            Self::KeeperState => 50_000,    // ~3 days
            Self::RoundMetadata    => 0,    // indefinite
            Self::SettlementReceipt => 0,   // indefinite for audit
        }
    }
}

/// Audit result for a storage key.
#[derive(Debug)]
pub struct StorageAuditEntry {
    pub key: String,
    pub kind: StorageKind,
    pub should_cleanup: bool,
    pub expected_ttl_ledgers: u32,
}

/// Returns the expected storage audit entries for a Sub Rosa round.
/// Use this to verify all keys are accounted for and have correct TTLs.
pub fn audit_round_storage(round_id: &str) -> Vec<StorageAuditEntry> {
    vec![
        StorageAuditEntry {
            key: format!("round:{}", round_id),
            kind: StorageKind::RoundMetadata,
            should_cleanup: false,
            expected_ttl_ledgers: StorageKind::RoundMetadata.expected_ttl_ledgers(),
        },
        StorageAuditEntry {
            key: format!("blobs:{}", round_id),
            kind: StorageKind::SealerBlob,
            should_cleanup: true,
            expected_ttl_ledgers: StorageKind::SealerBlob.expected_ttl_ledgers(),
        },
        StorageAuditEntry {
            key: format!("receipt:{}", round_id),
            kind: StorageKind::SettlementReceipt,
            should_cleanup: false,
            expected_ttl_ledgers: StorageKind::SettlementReceipt.expected_ttl_ledgers(),
        },
        StorageAuditEntry {
            key: format!("keeper:{}", round_id),
            kind: StorageKind::KeeperState,
            should_cleanup: true,
            expected_ttl_ledgers: StorageKind::KeeperState.expected_ttl_ledgers(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_returns_four_entries() {
        let entries = audit_round_storage("r1");
        assert_eq!(entries.len(), 4);
    }

    #[test]
    fn sealer_blobs_should_cleanup() {
        let entries = audit_round_storage("r1");
        let blobs = entries.iter().find(|e| e.kind == StorageKind::SealerBlob).unwrap();
        assert!(blobs.should_cleanup);
        assert!(blobs.expected_ttl_ledgers > 0);
    }

    #[test]
    fn settlement_receipts_are_permanent() {
        let entries = audit_round_storage("r1");
        let receipt = entries.iter().find(|e| e.kind == StorageKind::SettlementReceipt).unwrap();
        assert!(!receipt.should_cleanup);
        assert_eq!(receipt.expected_ttl_ledgers, 0);
    }

    #[test]
    fn keeper_state_should_cleanup() {
        let entries = audit_round_storage("r1");
        let keeper = entries.iter().find(|e| e.kind == StorageKind::KeeperState).unwrap();
        assert!(keeper.should_cleanup);
    }

    #[test]
    fn cleanup_count_is_two() {
        let entries = audit_round_storage("r1");
        let cleanup_count = entries.iter().filter(|e| e.should_cleanup).count();
        assert_eq!(cleanup_count, 2, "Exactly SealerBlob and KeeperState should cleanup");
    }
}
