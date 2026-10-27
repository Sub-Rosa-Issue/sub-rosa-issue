<!-- SPDX-License-Identifier: MIT -->

# Contributing to Sub Rosa

Thanks for helping out. This guide is deliberately **security-first**: it walks
through a local setup that does not implicitly trust editor tasks or run broad
install hooks.

## 1. Review a branch before opening it in an IDE

Editors auto-load extensions, run repo-defined tasks ("debug configurations",
"workspace tasks", pre-open shell scripts) and can mark the workspace as
trusted the moment you open it. Do the code review first:

```bash
git fetch origin
git switch <branch-name>
git log --oneline main..<branch-name>-unmerged..HEAD   # commits on the branch only
git diff main...HEAD                                   # full diff, read it here
```

(In a fork, compare against upstream instead: `git diff upstream/main...HEAD`.)

While reviewing:

- Look for new scripts that run at install time, postinstall hooks in
  `package.json`/`pnpm/package.json`, and edits to `.github/workflows/*` or
  `bindings:generate`-style scripts.
- Ask on the PR if anything is unclear. Reviewing first costs minutes;
  executing a malicious hook costs credentials.

Only after you have read the diff should you open the branch in an IDE — and
prefer an editor with an explicit workspace-trust prompt you can answer based
on what you just reviewed, rather than accepting the trust dialog blindly.

## 2. Prerequisites

The versions below are the ones the repository already pins (see
`package.json` → `engines` / `packageManager`, and `rust-toolchain.toml`).
Do not invent newer requirements.

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | `>= 22` | pinned by `engines.node` |
| pnpm | `10.13.1` | pinned by `packageManager`; `corepack enable` picks it up |
| Rust | stable + `wasm32v1-none` target | pinned by `rust-toolchain.toml` |
| Stellar CLI | latest | `cargo install stellar-cli --locked` |
| Build deps (Linux) | build-essential, pkg-config, libssl-dev, libdbus-1-dev, libudev-dev, libsodium-dev | same as CI (`.github/workflows/*`) |

```bash
corepack enable                       # gives you the pinned pnpm 10.13.1
rustup target add wasm32v1-none       # used by the Soroban contract builds
```

## 3. Install dependencies (frozen lockfile)

Always install with the committed lockfile so a PR cannot silently change a
dependency version:

```bash
pnpm install --frozen-lockfile
```

- `--frozen-lockfile` fails instead of writing `pnpm-lock.yaml`. Reworking a
  lockfile is a deliberate change on its own, never a side effect of setup.
- If you genuinely need a new dependency, add it intentionally, commit the
  lockfile change, and explain it in the PR.

## 4. Run the tests and typechecks

Everything uses one of two patterns, so you can scope a command to exactly
what you touched instead of running the whole workspace.

**TypeScript packages** (`packages/*`, `services/*`): filter by package name.

```bash
pnpm --filter @sub-rosa/sdk test
pnpm --filter @sub-rosa/sdk typecheck
# Shorthands for the same thing:
pnpm sdk:typecheck
pnpm keeper:test
pnpm tlock:typecheck
```

**Soroban contract** (`contracts/round`):

```bash
pnpm contract:test            # cargo test -p sub-rosa-round
pnpm contract:build           # stellar contract build
```

**Repo-wide guard scripts** — run the ones relevant to your change:

```bash
pnpm bindings:check           # generated TS bindings match the wasm
pnpm logging:check            # logging migration guard
pnpm errors:check             # round error-code guard
pnpm snapshot:check           # test snapshots are consistent
pnpm time:guard               # no direct time/timezone access
pnpm threat-model:check       # THREAT_MODEL.md anchors
pnpm docs:check-links         # markdown links (docs listed in script)
pnpm coverage:test            # aggregate TS line coverage (see docs/CI.md)
```

## 5. Opening a pull request

1. Work on a branch, keep the PR focused on one issue, and reference it in the
   description (e.g. `Closes #483`).
2. Run the focused test + typecheck for every area you touched, plus the guard
   scripts above if you touched the areas they protect.
3. Prefer reverting accidental formatting over restyling files you did not
   intend to touch; it keeps reviews diffable.

## 6. Security concerns and credentials

Sub Rosa is escrow and settlement infrastructure, so suspicious code and
credential exposure are first-class review concerns:

- **Never commit secret keys, mnemonics, RPC tokens, or test fixtures
  containing real credentials.** Contract "stations"/test identities belong in
  environment variables, not source files.
- **Do not paste contract outputs, receipts, or logs with account addresses
  and keys into PRs or docs.** Loosely treat anything a script printed when a
  key was on disk as sensitive.
- **Found suspicious code or leaked credentials?** Report it privately — see
  [SECURITY.md](./SECURITY.md). If your fork has not populated SECURITY.md
  yet, use the GitHub Security tab of the upstream repository,
  [Sub-Rosa-Issue/sub-rosa-issue](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/security),
  and choose "Report a vulnerability". Do not open a public issue for it.

## License

Contributions are made under the repository's [MIT License](./LICENSE).
