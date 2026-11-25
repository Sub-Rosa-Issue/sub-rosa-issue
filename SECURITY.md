# Security Policy

## Supported Versions

Security updates are applied to the latest `main` branch and active releases of Sub-Rosa.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |

## Reporting a Vulnerability (Private Vulnerability Reporting)

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

We use **GitHub Private Vulnerability Reporting** so security researchers can submit confidential security advisories directly to the maintainers:

1. Navigate to the [**Security Advisories**](https://github.com/Sub-Rosa-Issue/sub-rosa-issue/security/advisories/new) page for this repository (`Security` tab -> `Report a vulnerability`).
2. Provide a clear description of the vulnerability, affected component(s) (`contracts/sub-rosa`, `services/indexer`, `packages/sdk`, or `apps/web`), reproduction steps or proof-of-concept, and potential impact.
3. Submit the draft advisory privately.

### What to Expect

- **Acknowledgment**: Within 48 hours of submission.
- **Triage & Assessment**: Within 5 business days, maintainers will validate severity and coordinate remediation in a private fork associated with the security advisory.
- **Disclosure**: Coordinated disclosure once a patch is verified and released.

## Maintainer Verification & Automation

Maintainers can enable or verify GitHub Private Vulnerability Reporting at any time using the repository helper script:

```bash
# Check current Private Vulnerability Reporting status
node scripts/private-vulnerability-reporting.mjs --repo Sub-Rosa-Issue/sub-rosa-issue

# Enable Private Vulnerability Reporting via GitHub REST API
node scripts/private-vulnerability-reporting.mjs --repo Sub-Rosa-Issue/sub-rosa-issue --enable
```

See [`docs/PRIVATE_VULNERABILITY_REPORTING.md`](docs/PRIVATE_VULNERABILITY_REPORTING.md) for the complete operational runbook.
