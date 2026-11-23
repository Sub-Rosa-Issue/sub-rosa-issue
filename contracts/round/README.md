<!-- SPDX-License-Identifier: MIT -->
# Sub Rosa Round Contract

Soroban primitive that runs a sealed commit → verifiable-reveal →
on-chain-settle coordination round. Bids are sealed with Drand timelock
encryption until a future round `R`; round `R`'s threshold signature is
verified on-chain (BLS12-381) to force a simultaneous reveal.

- **Entry points**: [`src/lib.rs`](src/lib.rs)
- **Types and status machine**: [`src/types.rs`](src/types.rs)
- **Storage TTL policy**: [`src/storage.rs`](src/storage.rs)
- **Drand BLS verification**: [`src/drand.rs`](src/drand.rs)
- **Tests**: [`src/test.rs`](src/test.rs)

## Failure modes

Every failure surfaced by this contract has a defined code. There is no
silent fallback and no panic other than via [`soroban_sdk::panic_with_error`].
See [`ERRORS.md`](ERRORS.md) for the full table mapping code → condition →
user-facing message → suggested next action.

## Building and testing

```bash
cargo test -p sub-rosa-round
```

### Shared settlement fixture

[`fixtures/settlement-cases.txt`](fixtures/settlement-cases.txt) describes
settle and void cases in one table. This crate drives the contract through
every row (`settlement_fixture_drives_the_contract`,
`settlement_fixture_guard_reasons_match_contract_rules`), and the keeper's
settlement guard drives the same rows
(`services/keeper/src/settlement-guard.test.ts`). Editing the numbers on one
side only fails the other suite, so the guard's winner/refund rules cannot
drift from the contract's.

## Related docs

- [`docs/TECH_DESIGN.md`](../../docs/TECH_DESIGN.md) — system-wide architecture and storage model
- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md) — SDK integration guide (links to ERRORS.md)
- [`docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md) — security posture
