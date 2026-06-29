# Contributing to Sub-Rosa Drips

## CI/CD Pipeline

This repository uses GitHub Actions for continuous integration. The CI pipeline runs on every pull request and push to main/develop branches.

### Quality Gates

The following checks must pass before merging:

#### TypeScript Workspace
- TypeScript type checking for SDK, appraisal API, agent, and web
- Unit tests for SDK, tlock, keeper, appraisal API, agent, and web
- Production web build verification
- Code linting (if configured)

#### Rust/Soroban Contract
- Rust formatting check
- Clippy lint warnings
- Contract unit tests
- WASM build verification
- Contract size check

### Running Checks Locally

```bash
# TypeScript checks
pnpm typecheck
pnpm test:sdk
pnpm test:tlock
pnpm test:keeper
pnpm test:appraisal-api
pnpm test:agent
pnpm test:web
pnpm build:web
pnpm lint

# Rust checks
cargo fmt --all -- --check
cargo clippy -- -D warnings
cargo test --all
cargo build --release --target wasm32-unknown-unknown