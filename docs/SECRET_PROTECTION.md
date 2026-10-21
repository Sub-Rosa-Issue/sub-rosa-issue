# Secret protection

This repository treats leaked credentials as a first-class incident. Two
independent layers keep them out:

1. **Repository settings on GitHub** — secret scanning, push protection,
   non-provider pattern detection and validity checks. These live in GitHub's
   configuration for the repository, not in the tree, so they cannot be
   committed; they are verified with a script (see below).
2. **An in-repo CI gate** — `.github/workflows/secret-scan.yml` scans the
   history and the working tree with gitleaks on every push to `main` and on
   every incoming pull request.

The two layers fail differently on purpose: the settings stop a credential
before it lands in the history, and the CI gate stops it from landing in a
merge.

## Settings that must be enabled

| Setting | `security_and_analysis` field | Required |
| --- | --- | --- |
| Secret scanning | `secret_scanning` | yes |
| Push protection | `secret_scanning_push_protection` | yes |
| Non-provider pattern detection | `secret_scanning_non_provider_patterns` | where available |
| Validity checks | `secret_scanning_validity_checks` | where available |

The last two depend on what the repository's plan exposes. The API omits the
fields it does not offer, and this repository treats "not offered" as
"nothing to enable" — but it never treats "offered and off" as acceptable.

## Enabling them (repository admin)

In the web UI: **Settings → Code security and analysis → Secret scanning →
Enable**, and the same for **Push protection**.

From the command line, with a token that has **Administration: write** on the
repository:

```bash
export GITHUB_TOKEN=<token with Administration: write>
pnpm secrets:enable
```

`pnpm secrets:enable` runs `node scripts/check-secret-protection.mjs --enable`,
which enables one protection per request, ignores the ones the API reports as
unavailable (HTTP 422) and then re-reads the settings so the result is shown
from the API rather than from the request that was sent.

## Verifying them

```bash
export GITHUB_TOKEN=<token with Administration: read>
pnpm secrets:check
```

Expected output (one line per protection, then a summary):

```
[PASS] Secret scanning (secret_scanning) — enabled
[PASS] Push protection (secret_scanning_push_protection) — enabled
[PASS] Non-provider pattern detection (secret_scanning_non_provider_patterns) — enabled
[PASS] Validity checks (secret_scanning_validity_checks) — enabled
PASS: secret protection is enabled for Sub-Rosa-Issue/sub-rosa-issue
```

The command exits non-zero when a protection is disabled, when a required
protection is not reported by the API (usually a token without
**Administration: read**), or when the API call fails. `--json` prints the
same result as a single machine-readable line.

## What each protection covers

| Protection | Scope |
| --- | --- |
| Secret scanning | Scans the history of the default branch and every new push, and opens one alert per detected credential. |
| Push protection | Blocks a push that would introduce a credential — on any branch, including the branch behind an incoming pull request — and lets an admin review or override the block. |
| Non-provider pattern detection | Adds patterns for credentials that have no provider partner (generic API keys, private keys, and similar). |
| Validity checks | Marks each alert as active, inactive or unknown, so a live credential can be told apart from a revoked one. |

Because push protection blocks the push itself, it protects `main` and every
incoming pull request before the code is merged. Secret scanning then covers
what is already in the history.

## The CI gate

`.github/workflows/secret-scan.yml` runs on pushes to `main` and on pull
requests, and:

- downloads a pinned gitleaks release and verifies it against the published
  checksum before running it;
- scans the full history and the working tree with the default gitleaks rule
  set, so provider patterns and generic patterns are both covered;
- runs with `--redact`, so no secret value is ever written to the job log or
  to the SARIF report that gets uploaded to code scanning — reviewers see the
  rule, the file and the line, never the value;
- uploads the SARIF results to code scanning, so the findings show up in the
  repository's **Security** tab like native secret scanning alerts.

`.gitleaks.toml` keeps the default rules and allowlists only the values in
this repository that look like credentials but are not: Stellar contract IDs
(`C…`), Stellar account IDs (`G…`) and SHA-256 hashes in fixtures, mainnet
artifacts and demo traces. The allowlist pairs those file paths with those
value shapes, so a real credential dropped into one of those files does not
match it and still fails the job.

## Reviewing alerts without exposing values

- Review alerts in **Security → Secret scanning**. Do not copy the value into
  an issue, a pull request, a comment or a log.
- To list alerts from the API without the literal secret in the response:
  `gh api "repos/OWNER/REPO/secret-scanning/alerts?hide_secret=true"`.
- When an alert turns out to be a real credential: revoke or rotate it first,
  then resolve the alert as `revoked`. Resolve non-credentials as
  `false_positive` (or `used_in_tests` when they are test values).
- Record the alert number, the secret type and the location — never the value.

## Result of the initial scan

The initial scan of the complete history reachable from `main` (402 commits)
with the rules used by the CI gate found no credential. The only matches were
`generic-api-key` hits on public, non-secret values — Stellar contract IDs,
Stellar account IDs and SHA-256 hashes — in fixtures, mainnet artifacts and
demo traces. Those are exactly the values allowlisted in `.gitleaks.toml`, so
no rotation and no history rewrite are needed.

Native GitHub secret scanning will raise its own alerts for the same values,
because they look like high-entropy strings to a generic pattern. They can be
resolved as false positives; their values are public on-chain identifiers, but
they still do not belong in an issue or a comment.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm secrets:check` | Read the repository settings and report every protection |
| `pnpm secrets:enable` | Enable the settings (needs **Administration: write**) |
| `pnpm secrets:test` | Unit tests for the check/enable script |

See also [CI and quality gates](./CI.md) for the rest of the automated checks
and [DEPLOY.md](./DEPLOY.md) for how runtime secrets are handled in the
deployed app.
