# CI and quality gates

This document describes automated checks that protect the TypeScript workspace
(`packages/*` and `services/*`).

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
