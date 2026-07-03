# Known Limitations

Honest boundaries for hackathon submission. No hidden fallbacks.

## Network scope

| Proof | Network | What it shows |
| --- | --- | --- |
| Keeper lifecycle (USDC, 2 bidders) | **Testnet** | `pnpm lifecycle:e2e` |
| Multi-agent + x402 + UI trace | **Testnet** | `pnpm agents:e2e` |
| Primitive deploy + settle smoke | **Mainnet** | `pnpm mainnet:deploy`, `pnpm mainnet:settle`, `pnpm mainnet:verify` |
| Optional micro commit | **Mainnet** | `pnpm mainnet:micro` (dry-run default; tiny XLM only) |

Mainnet does **not** replay 700 / 459 USDC demo amounts. Mainnet smoke uses **1 XLM bid / 5 XLM escrow** on native XLM SAC.

## Off-chain enforcement

- **Mandate caps** (`maxBid`, `maxAppraisalSpend`) are verified by agent software, not the Soroban contract.
- Only **escrow** and **bid ≤ escrow** are enforced on-chain at reveal.
- A malicious or buggy agent could exceed mandate caps if funded — see `docs/THREAT_MODEL.md`.

## Not in critical path

- **OpenZeppelin Relayer Channels** — optional SDK submitter; all e2e scripts default to direct Soroban RPC.
- **Passkey-Kit** — UI demo + ecosystem docs; agents use Ed25519 session keys in this build.
- **Hosted appraisal API on mainnet** — x402 proof is testnet-only in automated e2e.

## UI demo trace

- **Single canonical trace** — `apps/web/src/demo/demo-trace.generated.ts`, written by `pnpm agents:e2e`.
- Covers agents → x402 → sealed commits → keeper reveal → clear → settle on one testnet contract.
- Optional live poll requires build-time `VITE_*` vars — see `docs/DEPLOY.md`.

## Receipt verification

Round receipts (`docs/RECEIPTS.md`) are **offline only** — the verifier checks internal consistency (commitment bindings, winner selection) but does **not** confirm the receipt matches current on-chain state. Trust the exporter; cross-check with multiple export runs.

## Operational

- Drand quicknet must publish round R for reveal to open; keeper can void after grace if R never arrives.
- Temporary storage expires after the reveal window — seals are not kept forever by design.
- Mainnet wasm upload requires substantial XLM for resource fees (~30+ XLM observed).

## Intentional PRD deviation

- **Two autonomous agents** instead of one — stronger supporting proof on testnet.
  The winning hackathon track was Hack Privacy.
