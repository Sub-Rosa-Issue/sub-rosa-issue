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

## GitHub Actions supply-chain policy

Workflow changes are reviewed as code, and the repository enforces three rules
on every workflow under `.github/workflows/`:

1. **Full-length SHA pins.** Every external `uses:` must reference a
   40-character lowercase commit SHA. Tags and branches (`@v4`, `@stable`) are
   rejected because they are mutable.
2. **Reviewed allowlist.** A pinned action must be listed, with that exact SHA,
   in `.github/actions-allowlist.json`. A pin the allowlist does not know about
   fails even when the action itself is trusted, and an allowlist entry no
   workflow uses fails as well, so the allowlist cannot silently widen.
3. **Read-only tokens.** Only `read` (or `none`) entries are accepted in a
   `permissions:` block. Adding `write` scopes requires a reviewed change to the
   checker itself.

Local composite actions (`uses: ./...`) are part of this repository and are
reviewed directly. `docker://` actions are rejected because they cannot be
pinned by commit SHA.

### Run locally

```bash
pnpm actions:test   # tests for the policy checker
pnpm actions:check  # verify every workflow pin and the allowlist
```

`Actions policy` (`.github/workflows/actions-policy.yml`) runs both commands on
pull requests and pushes that touch workflows, the allowlist, or the checker.

### Reviewed allowlist

| Action | Pinned SHA | Upstream ref |
| --- | --- | --- |
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` | `v4.4.0` |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `v4.4.0` |
| `pnpm/action-setup` | `b906affcce14559ad1aafd4ab0e942779e9f58b1` | `v4.3.0` |
| `dtolnay/rust-toolchain` | `b725eda525362e7cf34af9a7243cac1e3f01a7ec` | `stable` |
| `Swatinem/rust-cache` | `d1527c8f67ef9af357290475d4af4b0fab8f12e0` | `v2.9.3` |

`dtolnay/rust-toolchain` derives the toolchain from the ref it is invoked with.
Once pinned to a SHA that no longer holds a toolchain name, pass it explicitly:

```yaml
- uses: dtolnay/rust-toolchain@b725eda525362e7cf34af9a7243cac1e3f01a7ec # stable
  with:
    toolchain: stable
```

### Updating a pin

1. Review the upstream diff between the pinned SHA and the new release.
2. Update the `uses:` line and keep the human-readable version in the trailing
   comment (`# v4.4.0`).
3. Update the matching SHA in `.github/actions-allowlist.json`.
4. Run `pnpm actions:check` and open the PR with the upstream diff link.

### Repository settings

The checker backs the same guarantees at review time, but the authoritative
control is a repository setting that only maintainers can change. In
**Settings → Actions → General**:

- **Actions permissions:** *Allow select actions and reusable workflows*.
- Allow **GitHub-owned actions**, **verified Marketplace actions**, and the
  third-party actions in the table above (`pnpm/action-setup`,
  `dtolnay/rust-toolchain`, `Swatinem/rust-cache`). Nothing else is needed by
  the current workflows.
- **Require actions to be pinned to a full-length commit SHA:** enabled.

Settings are not stored in git, so record any change here when it happens.
