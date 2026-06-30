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

## Related docs

- [`docs/TECH_DESIGN.md`](../../docs/TECH_DESIGN.md) — system-wide architecture and storage model
- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md) — SDK integration guide (links to ERRORS.md)
- [`docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md) — security posture
