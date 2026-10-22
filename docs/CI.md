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

## Repository hygiene gates

`.github/workflows/coverage.yml` also runs two checks over the repository itself
rather than over its TypeScript sources.

### Single root lockfile

`scripts/check-root-lockfile.mjs` fails when the repository root tracks more than
one lockfile, tracks none, or tracks a lockfile that does not belong to the package
manager declared in `package.json`. This workspace is installed with
**pnpm 10.13.1**, so `pnpm-lock.yaml` is the only permitted tracked root lockfile;
`package-lock.json`, `yarn.lock`, `bun.lock` and `bun.lockb` are gitignored at the
root. Lockfiles inside a workspace folder are not part of this rule.

```bash
pnpm lockfile:test     # unit tests plus CLI fixtures
pnpm lockfile:check    # the CI step
```

### VS Code tasks that run on folder open

`scripts/check-vscode-tasks.mjs` fails when a tracked `.vscode/tasks.json` declares
`"runOn": "folderOpen"`. That trigger executes a task as soon as the folder is
opened, before anyone reads what it does. The guard audits tracked manifests only,
prints the offending path and line without the file contents, and never parses or
runs a task command.

```bash
pnpm vscode-tasks:test    # unit tests plus CLI fixtures
pnpm vscode-tasks:check   # the CI step
```
