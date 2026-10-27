<!-- SPDX-License-Identifier: MIT -->
# GitHub Actions security configuration

This document records repository-level GitHub Actions security settings so that
they can be reviewed and checked during audits.

## Fork pull request workflow approval

| Field | Value |
| --- | --- |
| Approval policy | `all_external_contributors` |
| Configured in | Repository **Settings → Actions → General → Fork pull request workflows** |
| Effective date | 2026-10-23 |
| Related issue | #487 |

### Why this policy

The previous policy required approval only for first-time contributors. A fork
account that had contributed before, but was later compromised, could therefore
start dependency installation and builds without maintainer review. Requiring
approval for **all** external contributors closes that gap: every workflow run
from an outside fork waits for an explicit maintainer approval.

### Intended access for internal users

The approval policy applies to external contributors. Members of the owning
organization and trusted internal collaborators are not treated as external
contributors, so their existing workflow access is unchanged. Repository
administrators can confirm the policy in the settings page above or through the
API:

```sh
gh api repos/OWNER/REPO/actions/permissions/fork-pr-contributor-approval
```

The expected response is:

```json
{"approval_policy":"all_external_contributors"}
```

### Secret exposure

Approval of a fork workflow run does **not** grant it repository secrets. The
workflows in this repository:

- use `pull_request`, never `pull_request_target`;
- declare `permissions: contents: read` only;
- do not reference `secrets.*`.

Workflows from forks of a public repository therefore run without repository
secrets. Keep it that way: do not add `pull_request_target` or secret references
to a workflow that checks out or executes untrusted fork code.

### Operational notes

- Approval requests appear on the pull request's **Checks** tab and in the
  Actions run list.
- Maintainers should review the workflow diff before approving a fork run.
- Do not post tokens, account identifiers, or other sensitive details when
  recording this setting in an issue.
