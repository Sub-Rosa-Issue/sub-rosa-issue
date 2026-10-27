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

## pnpm version manifest check

CI fails if any GitHub Actions workflow's `pnpm/action-setup` step declares
a different pnpm version than the root `package.json` `packageManager` field
(currently `pnpm@10.13.1`). This keeps every workflow on the exact pnpm
version developers and the committed lockfile use.

### Run locally

```bash
pnpm ci:pnpm-version:test   # unit tests for the checker itself
pnpm ci:pnpm-version:check  # scans .github/workflows/*.yml
```

Checker source: `scripts/check-pnpm-version.mjs` (tests in
`scripts/check-pnpm-version.test.mjs`).

### CI workflow

Wired into `.github/workflows/coverage.yml` (Node-only, runs on every push
and pull request to `main`).

### Changing the pnpm version

Bump `packageManager` in `package.json` and every `pnpm/action-setup`
`version:` in `.github/workflows/*.yml` together in the same PR; the check
fails loudly if they drift apart.

## Bindings worktree cleanliness gate

After `pnpm bindings:check` regenerates the round contract's TypeScript
bindings, CI runs `git diff --exit-code` so any unexpected drift in a
tracked, generated file is visible and blocking, not just the specific
`index.ts` comparison `bindings:check` already does on its own.

### CI workflow

`.github/workflows/bindings-check.yml`, immediately after the
"Check generated bindings are up to date" step.

### Run locally

```bash
pnpm bindings:check
git diff --exit-code
```

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
