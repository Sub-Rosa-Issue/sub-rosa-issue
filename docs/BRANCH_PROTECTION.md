# Branch protection for `main`

Recorded settings for issue
[#484](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/issues/484)
(`security(high/easy): protect main with reviewed PRs and blocked force-pushes`).

The default branch is protected by an **active repository ruleset**, not by a
legacy branch-protection rule. Before this change the repository had neither: the
ruleset list was empty and `GET /branches/main/protection` returned
`404 Branch not protected`.

## Applied ruleset

| Field | Value |
| --- | --- |
| Name | `Protect main` |
| ID | `25968240` |
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

The contexts are the GitHub Actions **job names** reported on pull requests.
Five workflows gate every PR through four contexts:

| Required context | Workflow | Job |
| --- | --- | --- |
| `check` | `Bindings check` (`.github/workflows/bindings-check.yml`) | `check` |
| `check` | `Line lengths check` (`.github/workflows/line-lengths.yml`) | `check` |
| `coverage` | `TypeScript coverage` (`.github/workflows/coverage.yml`) | `coverage` |
| `round-contract` | `Contract tests` (`.github/workflows/contract.yml`) | `round-contract` |
| `web` | `Web checks` (`.github/workflows/web.yml`) | `web` |

Two workflows both name their job `check`. GitHub matches required checks by
context name, and when several runs share a context **all of them must pass**, so
requiring `check` covers both the bindings and the line-lengths job.

### Deliberately not required

`Docs link check` (`check-links`) and `Environment template check` (`validate`)
are scoped by `on: pull_request: paths:`. GitHub leaves a required check from a
path-filtered workflow in a `Pending` state when the paths do not match, which
blocks every unrelated pull request indefinitely. They stay as advisory checks
until they run on every PR (for example behind an always-on gate job).

## Bypass actors

Exactly one bypass actor is configured: the repository **admin** role
(`actor_type: RepositoryRole`, `actor_id: 5`). No individual users, teams,
deploy keys, apps, or the `write`/`maintain` roles can bypass the ruleset. This
keeps an emergency escape hatch for repository owners without widening bypass
access beyond what is required to administer the repository.

For an organization-owned repository, organization owners retain bypass at the
organization level, so no `OrganizationAdmin` actor needs to be added here.

## Recorded settings

`GET /repos/timo126/sub-rosa-issue/rulesets/25968240`:

```json
{
  "id": 25968240,
  "name": "Protect main",
  "target": "branch",
  "source": "timo126/sub-rosa-issue",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": ["~DEFAULT_BRANCH"]
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
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "check" },
          { "context": "coverage" },
          { "context": "round-contract" },
          { "context": "web" }
        ]
      }
    }
  ]
}
```

The ruleset page is
<https://github.com/timo126/sub-rosa-issue/rules/25968240> and the rules are
listed under **Settings → Rules → Rulesets**.

Two parameters are left at their least-restrictive value because the issue does
not ask for them: `strict_required_status_checks_policy` (do not require PR
branches to be up to date with `main`) and
`require_extra_approval_for_unattributed_changes` (a newer GitHub default that
would otherwise demand two approvals on fork pull requests). Turn either on if
the project wants a stricter merge bar.

## Verification

Effective rules for the branch — confirms the ruleset is active and resolves
against `main`:

```bash
gh api repos/timo126/sub-rosa-issue/rules/branches/main
```

```json
[
  { "type": "deletion", "ruleset_id": 25968240, "ruleset_source_type": "Repository" },
  { "type": "non_fast_forward", "ruleset_id": 25968240, "ruleset_source_type": "Repository" },
  { "type": "pull_request", "ruleset_id": 25968240, "ruleset_source_type": "Repository" },
  { "type": "required_status_checks", "ruleset_id": 25968240, "ruleset_source_type": "Repository" }
]
```

That endpoint returns only rules from rulesets whose enforcement is `active` or
`evaluate`, so this output is direct evidence that merges into `main` must go
through an approved, CI-green pull request and that force pushes and deletions
are blocked.

## Applying this to the upstream repository

The ruleset above is applied to `timo126/sub-rosa-issue`, the fork, which is the
only repository where the automation account holds `admin`. The upstream
`Sub-Rosa-Issue/sub-rosa-issue` returns `permissions.admin = false` for the same
token, so a maintainer with admin rights must apply it there. Either reproduce
the settings through **Settings → Rules → New ruleset** or POST the payload from
the JSON block above:

```bash
gh api --method POST repos/Sub-Rosa-Issue/sub-rosa-issue/rulesets \
  --input ruleset-main.json
```

No source code, workflow, or dependency change is part of this hardening.
