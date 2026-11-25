# Dependabot alerts and security updates

This runbook covers the **repository settings** that give Sub Rosa automatic
vulnerability alerts and targeted security-fix PRs for its npm, Cargo, and
GitHub Actions dependencies.

These settings live in GitHub, not in the tree, so a pull request cannot turn
them on by itself. A maintainer with **admin** access applies them once, using
either the UI or the helper script below, and anyone with admin access can
verify them later.

> **Not covered here:** scheduled version updates (weekly grouped PRs via
> `.github/dependabot.yml`) are tracked separately in
> [#482](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/issues/482).
> Security updates work with or without that file, and this runbook does not
> upgrade any dependency.

## What gets enabled

| Setting | What it does | Who can see it |
| --- | --- | --- |
| Dependency graph | Parses `package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`, and workflow files to build the dependency inventory. | Public repos: everyone (it's the read-only *Insights → Dependency graph* view, with no vulnerability data). |
| Dependabot alerts | Matches the dependency graph against the GitHub Advisory Database and raises an alert for each vulnerable dependency. | Collaborators with write, maintain, or admin roles (see [Alert visibility](#alert-visibility)). |
| Dependabot security updates | Opens a PR that bumps **only** the vulnerable dependency to the minimum patched version. | Same as alerts. The PRs themselves are public, like any other PR. |

Security updates stay **targeted**: GitHub raises one PR per advisory (or one
grouped PR per ecosystem, if grouped security updates are turned on later),
moves the vulnerable package only to the lowest fixed version, and does
nothing for dependencies without a known advisory. Routine bumps belong to the
scheduled configuration in #482.

## Option A: GitHub UI

1. Open **Settings → Advanced Security** (on older UIs: **Settings → Code
   security and analysis**).
2. **Dependency graph**: already on and locked for public repositories. On a
   private fork, click **Enable**.
3. **Dependabot alerts**: click **Enable**.
4. **Dependabot security updates**: click **Enable**. GitHub greys this out
   until alerts are on.
5. Leave **Grouped security updates** off for now, so each advisory gets its
   own reviewable PR.
6. Run the [verification](#verify) step.

## Option B: helper script

[`scripts/dependabot-security.mjs`](../scripts/dependabot-security.mjs) calls
the GitHub REST API through the authenticated `gh` CLI. It needs `gh auth
login` with an account that has **admin** on the repository.

```bash
# Enable alerts, then security updates, then print the resulting state
pnpm dependabot:apply

# Same, against a fork or another repo
node scripts/dependabot-security.mjs --repo owner/name --apply
```

The script calls:

| Step | Endpoint |
| --- | --- |
| Enable alerts | `PUT /repos/{owner}/{repo}/vulnerability-alerts` |
| Enable security updates | `PUT /repos/{owner}/{repo}/automated-security-fixes` |
| Verify alerts | `GET /repos/{owner}/{repo}/vulnerability-alerts` (204 = on) |
| Verify security updates | `GET /repos/{owner}/{repo}/automated-security-fixes` (`enabled`, `paused`) |

The order matters: GitHub rejects security updates while alerts are off, so
the script stops if the first call fails.

## Verify

```bash
pnpm dependabot:check
```

Expected output once everything is on (logged as structured JSON lines):

```
[ENABLED] Dependency graph — Always on for public repositories.
[ENABLED] Dependabot alerts
[ENABLED] Dependabot security updates
All Dependabot security settings are enabled on Sub-Rosa-Issue/sub-rosa-issue
```

Exit codes: `0` everything is on, `1` a setting is disabled, paused, or
unreadable, `2` bad arguments.

> GitHub returns `404` both when alerts are off **and** when the caller lacks
> admin access. A `DISABLED` result from a non-admin account therefore proves
> nothing. Run the check as an admin.

Manual checks after enabling:

- **Security → Dependabot** lists open alerts (or "No Dependabot alerts").
- **Insights → Dependency graph → Dependabot** shows each ecosystem
  (`npm`, `cargo`, `github-actions`) as monitored.
- If an alert exists for a dependency with a patched release, a PR authored
  by `dependabot[bot]` appears within a few minutes. GitHub labels it
  `dependencies` only if that label exists; otherwise, add the existing
  `security` label during triage.

## Alert visibility

Vulnerability details count as security-sensitive information, so treat them
that way:

- Alert details are visible only to collaborators with **write**,
  **maintain**, or **admin** roles. Read-only contributors (including Wave
  contributors working from forks) and the public **cannot** see them.
- Before enabling, review **Settings → Collaborators and teams** and make sure
  only maintainers hold write access or above. At the organization level,
  owners can also grant alert access to specific security managers.
- Security-update PRs are public. They name the bumped package and versions
  and link the public advisory, but they do not expose the private alerts
  list.
- Use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  for issues found **in Sub Rosa itself**, not public issues.

## Handling security-update PRs

1. CI (`contract.yml`, `coverage.yml`, `bindings-check.yml`) must pass as it
   would for any PR.
2. Check that the diff touches only the lockfile and manifest entries for the
   vulnerable package. Close any PR that drags in unrelated upgrades and fix it
   by hand.
3. For `cargo` bumps that reach `contracts/round`, also run
   `pnpm contract:test` and `pnpm bindings:check` locally. A dependency bump
   must not change the generated bindings.
4. Dismiss an alert only with a recorded reason (*tolerable risk*, *not used*,
   *inaccurate*) so the decision stays auditable.

## Related

- [#486](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/issues/486): this
  runbook (alerts and security updates).
- [#482](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/issues/482):
  scheduled weekly version updates via `.github/dependabot.yml`.
- [docs/CI.md](./CI.md): the CI gates every security-update PR must pass.
- [docs/THREAT_MODEL.md](./THREAT_MODEL.md): the project threat model.
