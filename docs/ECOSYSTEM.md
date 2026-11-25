<!-- SPDX-License-Identifier: MIT -->
# Ecosystem Integration — Passkey, Relayer, Scaffold

Sub Rosa's live path uses **Ed25519 session keys + signed mandates** and **direct Soroban RPC**. It also ships optional ecosystem adapters that do not change the core protocol: Passkey-Kit in the web wallet panel, and OpenZeppelin Relayer Channels as an SDK submitter.

## Authorization model mapping

| Demo (today) | Production (Passkey / Smart Account) |
| --- | --- |
| Principal G-address | Passkey-controlled OZ Smart Account |
| Session Ed25519 key | Policy signer or context rule scoped to Round contract |
| Signed mandate JSON | Smart Account spending limit + contract allowlist |
| Agent verifies caps off-chain | Wallet policy + agent double-check |
| Session signs commit + x402 | Session signer submits via RPC or relayer |

The **mandate** is the off-chain stand-in for what Smart Account Kit encodes as **context rules** and **spending limits**.

## Passkey-Kit (legacy)

- npm: `passkey-kit`
- Demo: https://passkey-kit-demo.pages.dev/
- WebAuthn secp256r1 → Stellar smart wallet precursor
- **Note:** Kalepail recommends **smart-account-kit** for new projects

### When to use

Hackathon jury narrative: the Passkey tab runs **passkey-kit** in-browser — **Create passkey** works on localhost without extra env (default testnet WASM hash is embedded).

## Smart Account Kit (recommended production path)

- npm: `smart-account-kit`
- Repo: https://github.com/kalepail/smart-account-kit
- Built on **OpenZeppelin Stellar Smart Accounts** (audited contracts)

### Features relevant to Sub Rosa agents

- **Passkey authentication** — principal never exports seed
- **Policy signers** — delegate session key with limits
- **Context rules** — restrict calls to Round contract + max amounts
- **Session persistence** — agent reconnect without re-prompting passkey every tx

### Integration sketch (not implemented in demo)

1. Principal creates smart account with passkey
2. Add policy signer = agent session key, limits = mandate caps
3. Agent runs same `runBidderAgent` flow but `secretKey` is policy signer
4. Optional: relayer sponsors fees

## OpenZeppelin Relayer (scored flex)

- Guide: https://docs.openzeppelin.com/relayer/1.3.x/guides/stellar-channels-guide
- Submits passkey-signed transactions without user holding XLM for fees

### Sub Rosa stance

| Path | Used in demo? | Why |
| --- | --- | --- |
| Direct Soroban RPC | **Yes** | Proven in all e2e; simplest; no relayer dependency |
| OZ Relayer channels | Optional SDK submitter | Production UX for passkey wallets; fee sponsorship |

Relayer does **not** replace keeper or x402 facilitator — it only changes **who pays the Soroban fee** for a signed tx.

## Scaffold Stellar

- Repo: https://github.com/thebadass-dev/scaffold-stellar
- Standard Vite + Stellar app scaffold

Sub Rosa ships a **custom jury UI** (`apps/web`) rather than Scaffold, but the same stack applies: replace manual keypair with smart-account-kit for wallet connect.

## x402 + SAC alignment

Both appraisal (x402) and prize settlement (`settle()`) use **SEP-41 tokens** — USDC on testnet, native XLM SAC on mainnet smoke. x402 is HTTP-gated micro-payment; settle is contract SAC transfer. See `docs/TECH_DESIGN.md`.

## Links

| Resource | URL |
| --- | --- |
| Passkey-Kit demo | https://passkey-kit-demo.pages.dev/ |
| Smart Account Kit | https://github.com/kalepail/smart-account-kit |
| OZ Stellar Smart Accounts | https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account |
| OZ Relayer Stellar guide | https://docs.openzeppelin.com/relayer/1.3.x/guides/stellar-channels-guide |
| Drand quicknet | https://drand.love |
| x402 Stellar | https://github.com/coinbase/x402 |
