# CI and quality gates

This document describes automated checks that protect the TypeScript workspace
(`packages/*` and `services/*`).

## Test coverage gate

The repository enforces a minimum **aggregate line coverage** threshold for
TypeScript packages and services that ship unit tests.

| Setting | Location | Default |
| --- | --- | --- |
| Threshold | `coverage.config.json` → `lineThresholdPercent` | `80` |
| Workspaces | `coverage.config.json` → `workspaces` | SDK, tlock, bindings, keeper, agent, appraisal-api, receipt-cli, auction-template |

### How coverage is computed

1. Each configured workspace runs its existing `test` script under the Node.js
   test runner with `--experimental-test-coverage`.
2. Test files (`*.test.ts`) are excluded from coverage via
   `--test-coverage-exclude`.
3. The script prints per-workspace line coverage and an **aggregate mean** across
   all configured workspaces.
4. CI fails when the aggregate mean drops below `lineThresholdPercent`.

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
in the PR. Lower the threshold only when the existing codebase cannot meet a
higher bar yet; prefer adding tests instead of weakening the gate.
