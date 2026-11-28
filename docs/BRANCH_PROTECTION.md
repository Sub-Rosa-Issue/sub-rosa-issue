# Branch protection for `main`

Proposed settings for issue
[#484](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/issues/484)
(`security(high/easy): protect main with reviewed PRs and blocked force-pushes`).

## Current status: not yet applied upstream

> **`Sub-Rosa-Issue/sub-rosa-issue` `main` is not protected.** This document is
> the reviewed ruleset an org admin needs to apply. It does not record an active
> upstream setting. Issue #484 is done only when the
> [verification](#verification-after-applying) below passes against the
> upstream repository.

Live state, checked `2026-11-28T08:45Z` against upstream `main` at `939e22e`:

| Check | Result |
| --- | --- |
| `gh api repos/Sub-Rosa-Issue/sub-rosa-issue/rules/branches/main` | `[]`, so no active rules apply to `main` |
| `gh api repos/Sub-Rosa-Issue/sub-rosa-issue/rulesets` | `[]`, so no rulesets exist |
| `gh api repos/Sub-Rosa-Issue/sub-rosa-issue/rulesets/25968240` | `404 Not Found` |
| `gh api repos/Sub-Rosa-Issue/sub-rosa-issue --jq .permissions.admin` | `false` for the PR author's token |

Ruleset `25968240` exists only on the contributor fork
`timo126/sub-rosa-issue`. Ruleset IDs are per repository, so that ID does not
mean anything upstream. The fork copy was a dry run: it confirmed that GitHub
accepts the payload and that it resolves against a `main` branch. It protects
nothing in this repository. The PR author cannot create the upstream ruleset,
because that needs admin rights on `Sub-Rosa-Issue/sub-rosa-issue`.

## Proposed ruleset

| Field | Value |
| --- | --- |
| Name | `Protect main` |
| Target | `branch` |
| Enforcement | `active` |
| Conditions | `ref_name.include = ["~DEFAULT_BRANCH"]`, no exclusions |

`~DEFAULT_BRANCH` resolves to `main`, so the ruleset follows the default branch if
it is ever renamed.

## Mapping to the acceptance criteria

| Acceptance criterion | Ruleset rule / parameter |
| --- | --- |
| Require changes through pull requests | `pull_request` |
| At least one approving review | `pull_request.required_approving_review_count = 1` |
| Dismiss stale approvals after new pushes | `pull_request.dismiss_stale_reviews_on_push = true` |
| Require the existing CI checks before merge | `required_status_checks` (see below) |
| Block force pushes | `non_fast_forward` |
| Block branch deletion | `deletion` |
| Bypass limited to the minimum required administrators | `bypass_actors = [{ RepositoryRole, 5, always }]` |

The `pull_request` rule is what rejects direct pushes to `main`: commits must
first land on another branch and be submitted as a pull request.

## Required status checks

The contexts are the GitHub Actions **job names**. They were taken from upstream
`main` at `939e22e`, and each one already reports a check run on that commit.
Nine workflows that run on every pull request gate it through eight contexts:

| Required context | Workflow | Job |
| --- | --- | --- |
| `agent` | `Agent checks` (`.github/workflows/agent.yml`) | `agent` |
| `appraisal` | `Appraisal API checks` (`.github/workflows/appraisal.yml`) | `appraisal` |
| `check` | `Bindings check` (`.github/workflows/bindings-check.yml`) | `check` |
| `check` | `Line lengths check` (`.github/workflows/line-lengths.yml`) | `check` |
| `coverage` | `TypeScript coverage` (`.github/workflows/coverage.yml`) | `coverage` |
| `keeper` | `Keeper checks` (`.github/workflows/keeper.yml`) | `keeper` |
| `round-contract` | `Contract tests` (`.github/workflows/contract.yml`) | `round-contract` |
| `sdk` | `SDK checks` (`.github/workflows/sdk.yml`) | `sdk` |
| `web` | `Web checks` (`.github/workflows/web.yml`) | `web` |

Two workflows both name their job `check`. GitHub matches required checks by
context name, and when several runs share a context **all of them must pass**.
Requiring `check` therefore covers both the bindings job and the line-lengths
job. Any later always-on workflow whose job is named `check` is also covered
automatically.

Re-read the job names in `.github/workflows/` before applying. If a gate was
added or renamed since `939e22e`, update `required_status_checks` to match. A
required context that never reports leaves every pull request blocked.

### Deliberately not required

`Docs link check` (`check-links`) and `Environment template check` (`validate`)
use `on: pull_request: paths:` filters. When the paths don't match, GitHub
leaves a required check from a path-filtered workflow in `Pending`, which would
block every unrelated pull request indefinitely. These two stay advisory until
they run on every PR (for example behind an always-on gate job).

## Bypass actors

The ruleset configures exactly one bypass actor: the repository **admin** role
(`actor_type: RepositoryRole`, `actor_id: 5`). Individual users, teams, deploy
keys, apps, and the `write` and `maintain` roles cannot bypass it. Repository
owners keep an emergency escape hatch, and bypass access goes no wider than
administering the repository requires.

For an organization-owned repository, organization owners keep bypass at the
organization level, so no `OrganizationAdmin` actor needs to be added here.

## Payload to apply

[`ruleset-main.json`](ruleset-main.json) is the request body for
`POST /repos/{owner}/{repo}/rulesets`, reproduced here:

```json
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "agent" },
          { "context": "appraisal" },
          { "context": "check" },
          { "context": "coverage" },
          { "context": "keeper" },
          { "context": "round-contract" },
          { "context": "sdk" },
          { "context": "web" }
        ]
      }
    }
  ]
}
```

`strict_required_status_checks_policy` is left `false`, so PR branches do not
have to be up to date with `main`. The issue does not ask for that. Turn it on if
the project wants a stricter merge bar.

An org admin applies the payload from the repository root:

```bash
gh api --method POST repos/Sub-Rosa-Issue/sub-rosa-issue/rulesets \
  --input docs/ruleset-main.json
```

Alternatively, enter the same values through
**Settings → Rules → Rulesets → New branch ruleset**.

## Verification after applying

Run these against the **upstream** repository. Results from the fork do not
count.

```bash
# 1. The ruleset exists and is active. Note the new upstream ID.
gh api repos/Sub-Rosa-Issue/sub-rosa-issue/rulesets \
  --jq '.[] | {id, name, enforcement}'

# 2. Effective rules on main. Expect four entries
#    (deletion, non_fast_forward, pull_request, required_status_checks),
#    all with ruleset_source "Sub-Rosa-Issue/sub-rosa-issue".
gh api repos/Sub-Rosa-Issue/sub-rosa-issue/rules/branches/main \
  --jq '.[] | {type, ruleset_source, ruleset_id}'
```

`rules/branches/main` returns only rules from rulesets whose enforcement is
`active` or `evaluate`. Four entries there are the evidence that #484 is done.
Record the upstream ruleset ID and that output on the issue. An empty array `[]`,
which is today's result, means `main` is still unprotected.

No source code, workflow, or dependency change is part of this hardening.
