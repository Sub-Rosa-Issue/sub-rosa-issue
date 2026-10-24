# CI and quality gates

This document describes automated checks for the web app and TypeScript
workspaces (`apps/*`, `packages/*`, and `services/*`).

## Web checks

The `Web checks` workflow (`.github/workflows/web.yml`) runs on pushes to
`main` and on pull requests. Its single blocking job installs locked JS
dependencies without lifecycle scripts, then runs `pnpm web:test`,
`pnpm web:typecheck`, and `pnpm web:build` in order. Run the same three commands
locally to check `apps/web`; `node --test scripts/web-ci.test.mjs` verifies the
CI job configuration.

## Test coverage gate

The repository enforces a minimum **aggregate line coverage** threshold for
TypeScript packages and services that ship unit tests.

| Setting | Location | Default |
| --- | --- | --- |
| Threshold | `coverage.config.json` → `lineThresholdPercent` | `70` |
| Workspaces | `coverage.config.json` → `workspaces` | SDK, tlock, bindings, keeper, agent, appraisal-api, receipt-cli, auction-template |

### How coverage is computed

1. Each configured workspace runs its existing `test` script under the Node.js
   test runner with `--experimental-test-coverage`.
2. Coverage is collected via the machine-readable **lcov** reporter (not the
   human TAP/spec summary table).
3. Test files (`*.test.ts`) are excluded; every non-test file under `src/` is
   included. Files never loaded by tests still contribute their source lines as
   **uncovered**.
4. The script prints per-workspace covered/total line counts and a **weighted**
   aggregate: `sum(covered) / sum(total)` across all configured workspaces.
5. CI fails when the weighted aggregate drops below `lineThresholdPercent`.

Runner unit tests live in `scripts/run-ts-coverage.test.mjs`
(`node --test scripts/run-ts-coverage.test.mjs`).

### Run locally

```bash
pnpm install
pnpm coverage:test
```

### CI workflow

GitHub Actions workflow: `.github/workflows/coverage.yml`

It runs on pushes and pull requests to `main`, prints the coverage summary to
the job log, and fails the check when the threshold is not met.

### Changing the threshold

Update `lineThresholdPercent` in `coverage.config.json` and mention the change
in the PR. The default is calibrated against the **weighted** covered/total
ratio after including unexecuted `src/` files. Lower the threshold only when
the existing codebase cannot meet a higher bar yet; prefer adding tests instead
of weakening the gate.

## Bindings check

GitHub Actions workflow: `.github/workflows/bindings-check.yml`

Generated contract bindings are built with Stellar CLI **22.8.2**. That is the
latest stable 22.x release on crates.io, and it is the newest CLI that still
supports this repo's `soroban-sdk` 22 (`Cargo.lock` resolves 22.0.11).
`stellar-cli` 23.0.0 and newer depend on `soroban-sdk` 23, so they are not
used for this contract.

CI installs that release with:

```bash
cargo install stellar-cli --version 22.8.2 --locked
stellar --version
```

`stellar --version` runs before `pnpm bindings:check`. The pin, `--locked`, and
print order are asserted by:

```bash
node --test scripts/check-bindings-cli.test.mjs
```

## Pinned Rust toolchain

The workspace pins Rust **1.85.0** with target `wasm32v1-none` in
`rust-toolchain.toml` and `Cargo.toml` (`[workspace.package] rust-version = "1.85.0"`),
replacing a moving `stable` channel reference so contract builds and
`stellar-cli` bindings checks stay reproducible across local runs and both
contract workflows (`.github/workflows/contract.yml` and
`.github/workflows/bindings-check.yml`). Validate the pin and alignment locally
with:

```bash
pnpm rust:toolchain:test
pnpm rust:toolchain:check
```
