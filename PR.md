# PR: Pin Third-Party GitHub Actions to Immutable Commit SHAs

## Summary

Pins every third-party GitHub Action in `.github/workflows/*.yml` to a full 40-character commit SHA with a trailing comment preserving the human-readable release tag. This makes workflow dependencies immutable and auditable.

## Motivation

GitHub Actions referenced by moving tags (e.g., `actions/checkout@v4`) can be mutated by the action owner. Pinning to commit SHAs ensures the exact code reviewed is the code executed in CI, preventing supply-chain attacks where a compromised action publisher pushes malicious code to an existing tag.

## Changes

All 7 workflow files updated:

| Workflow | Actions Pinned |
|----------|----------------|
| `bindings-check.yml` | 5 actions |
| `contract.yml` | 4 actions |
| `coverage.yml` | 3 actions |
| `docs-links.yml` | 2 actions |
| `env-examples.yml` | 2 actions |
| `line-lengths.yml` | 3 actions |
| `web.yml` | 3 actions |
| **Total** | **22 `uses:` entries pinned** |

### Pin Mappings

| Action | Original Tag | Pinned SHA | Comment |
|--------|--------------|------------|---------|
| `actions/checkout` | `v4` | `11d5960a326750d5838078e36cf38b85af677262` | `# v4` |
| `actions/setup-node` | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `# v4` |
| `pnpm/action-setup` | `v4` | `f40ffcd9367d9f12939873eb1018b921a783ffaa` | `# v4` |
| `dtolnay/rust-toolchain` | `stable` | `683b588c487a69d01f6c6ddf40f036ff682cc2c8` | `# stable (v1)` |
| `Swatinem/rust-cache` | `v2` | `d1527c8f67ef9af357290475d4af4b0fab8f12e0` | `# v2` |

## Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | Every `uses:` entry pinned to 40-char commit SHA | ✅ 22 entries, all 40 hex chars |
| 2 | Each pin includes trailing comment with release tag | ✅ All have `# v4`, `# stable (v1)`, or `# v2` |
| 3 | Existing workflow behavior, permissions, timeouts unchanged | ✅ Only `uses:` lines modified |
| 4 | No local action path accidentally rewritten | ✅ No local actions (`./path`) existed |

## Verification

```bash
# Verify all SHAs are 40 characters
grep -o "@[a-f0-9]\{40\}" .github/workflows/*.yml | sort -u

# Verify all have version comments
grep "uses:" .github/workflows/*.yml
# All lines end with # v4 / # stable (v1) / # v2
```

## Example Diff

```diff
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
-
-      - uses: dtolnay/rust-toolchain@stable
+      - uses: dtolnay/rust-toolchain@683b588c487a69d01f6c6ddf40f036ff682cc2c8 # stable (v1)
-
-      - uses: Swatinem/rust-cache@v2
+      - uses: Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2
```

## How to Update Pins in Future

When a new version of an action is desired:

1. Find the commit SHA for the new tag:
   ```bash
   curl -s "https://api.github.com/repos/actions/checkout/git/refs/tags/v4" | jq -r .object.sha
   ```

2. Replace the SHA and update the comment in all workflow files.

3. Test the workflows in a branch before merging.

## Related

- Issue: #481 — "security(ci): pin third-party GitHub Actions to immutable commit SHAs"
- GitHub Docs: [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)