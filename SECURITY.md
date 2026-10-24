<!-- SPDX-License-Identifier: MIT -->
# Security Policy

This document defines the supported branches, private vulnerability reporting
process, and credential-compromise response checklist for the Sub Rosa
repository (`Sub-Rosa-Issue/sub-rosa-issue`).

## Supported Versions

Security fixes are applied to the `main` branch (`0.1.x` pre-release workspace
packages and Soroban contract primitive):

| Component | Branch / Version | Supported |
| --- | --- | --- |
| `contracts/round` (Soroban primitive) | `main` (`0.1.x`) | Yes |
| `@sub-rosa/sdk` & `@sub-rosa/tlock` | `main` (`0.1.x`) | Yes |
| `services/keeper`, `services/appraisal-api`, `services/agent` | `main` (`0.1.x`) | Yes |
| `apps/web` | `main` (`0.1.x`) | Yes |
| Older commits / unmerged feature branches | `< main` | No |

## Reporting a Vulnerability Privately

**Do not open a public GitHub issue, pull request, or discussion** for
suspected security vulnerabilities, and **never post live Stellar secret seeds
(`S...`), private keys, RPC tokens, or unredacted environment files** in any
report.

1. Use **[GitHub Private Vulnerability Reporting](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/security/advisories/new)**
   (`Security` → `Report a vulnerability` in this repository) to submit a
   confidential advisory directly to the maintainers.
2. Include:
   - Affected component(s) (`contracts/round`, `@sub-rosa/sdk`, `@sub-rosa/tlock`, `services/keeper`, etc.) and commit SHA.
   - Minimal reproduction steps or a deterministic test fixture using generated throwaway keys (`Keypair.random()`).
   - Impact assessment (e.g., escrow conservation, premature bid disclosure, signature verification, or keeper availability).
3. Maintainers acknowledge private reports within **72 hours**, coordinate a fix
   in a private advisory branch, and publish a regression test once the fix is
   merged.

## Incident Response: Suspected Credential or Key Theft

If a Stellar secret seed (`ADMIN_SECRET_KEY`, keeper/operator key, agent
mandate signer), GitHub token, or RPC credential is suspected of being exposed
or compromised, execute the following steps immediately:

1. **Isolate:**
   - Immediately stop affected keeper, appraisal-api, or agent processes.
   - Disconnect the compromised workstation, container, or CI runner from
     network access so no further signed transactions or API calls can be
     originated from that host.
2. **Revoke:**
   - Revoke exposed GitHub Personal Access Tokens, Actions secrets, and RPC
     provider API keys.
   - On Stellar, revoke or remove compromised signer weights / session-key
     mandates on the affected account or contract configuration.
3. **Rotate from a clean machine:**
   - Provision fresh Stellar keypairs and API credentials **only from a
     verified clean machine** (never on the host where the leak occurred).
   - Update deployment secrets and verify on-chain round and escrow invariants
     with `pnpm mainnet:verify` and `pnpm mainnet:ready -- --strict`.
4. **Preserve evidence:**
   - Before wiping or redeploying the affected system, preserve structured JSON
     logs, shell history, CI run logs, and on-chain round receipts exported via
     `@sub-rosa/receipt-cli` (`pnpm receipt:test` / `receipt-cli`) for post-incident
     forensic review.
