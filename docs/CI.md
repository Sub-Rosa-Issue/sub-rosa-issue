# CI and quality gates

This document describes automated checks that protect the TypeScript workspace
(`packages/*` and `services/*`).

## Secret scanning gate

Workflow: `.github/workflows/secret-scan.yml`

It runs on pushes to `main` and on incoming pull requests. Every run scans
the git history and the working tree with gitleaks (default rule set, config
in `.gitleaks.toml`) and fails when a credential is found. Findings are
uploaded to code scanning as SARIF, and every report is redacted: the job log
and the SARIF carry the rule, the file and the line, never the secret value.

The GitHub-side settings (secret scanning, push protection, non-provider
patterns, validity checks) live in the repository configuration rather than in
the tree. `pnpm secrets:check` reads them and `pnpm secrets:enable` turns
them on. See [SECRET_PROTECTION.md](./SECRET_PROTECTION.md).

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
