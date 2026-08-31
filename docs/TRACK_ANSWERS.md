<!-- SPDX-License-Identifier: MIT -->
# Track Answers — Build On Stellar / IBW 2026

Sub Rosa won **1st Place in the Hack Privacy Track**. The multi-agent/x402,
mainnet smoke, SDK, and ecosystem paths stay in the product as supporting
evidence that the privacy primitive can become reusable Stellar infrastructure.

## Summary

| Submission area | Strength | Weak point (before) | Addressed by |
| --- | --- | --- | --- |
| Hack Privacy | tlock + on-chain BLS in code | Separate threat model + auditor UI missing | `docs/THREAT_MODEL.md`, Auditor tab + e2e blob decrypt |
| Infrastructure support | Reusable primitive, SDK, mainnet, ecosystem depth | OZ Relayer / Passkey "scored flex" thin | OZ Channels adapter, Passkey-Kit demo, `docs/ECOSYSTEM.md` |
| Supporting agent proof | Multi-agent live e2e, mandate, x402, cap negatives | Cap partly off-chain | Passkey tab, honest cap copy, `docs/THREAT_MODEL.md` |

---

## Infrastructure support

### What we prove

- Reusable **Round** Soroban contract with full lifecycle
- **SDK** with spec-accurate bindings from wasm
- **Mainnet deploy + settlement** (`CA7KSDEY…`)
- **Watch-mode keeper** for liveness
- Ecosystem hooks documented (Passkey-Kit, Smart Account Kit, Scaffold Stellar)

### OZ Relayer (scored flex)

**Status:** Optional submitter adapter implemented; direct RPC remains default.

`packages/sdk` accepts a `submitter`, and `createOzChannelsSubmitter()` sends signed XDR through OpenZeppelin Relayer Channels. All existing e2e scripts still use **direct Soroban RPC** by default, preserving the proven path.

### Passkey-Kit / Scaffold Stellar (scored flex)

**Status:** Passkey-Kit is installed and lazy-loaded in the UI wallet panel.

The panel creates a real browser passkey via passkey-kit (embedded testnet WASM). Optional **Deploy smart wallet** may fail without sponsor funding — not required for submission. Agent mandate enforcement intentionally stays on Ed25519 session keys in this build.

---

## Privacy track

### What we prove

- Drand **tlock** seal with live quicknet
- **On-chain BLS12-381** verification at `open_reveal`
- **Auditor blob** (X25519 sealed box) in `packages/tlock`
- Seal attack demo (seal-off vs seal-on) in UI

### Threat model

**Status:** `docs/THREAT_MODEL.md` — adversaries, mitigations, residual risks, honest off-chain limits.

### Auditor UI

**Status:** `apps/web` **Auditor** tab:

- Paste auditor secret (hex) → decrypt identity blobs emitted by `pnpm agents:e2e`
- Live bid decrypt against published R via quicknet

### Drand R countdown

**Status:** Live quicknet countdown in site header + lifecycle banner.

---

## Supporting agent proof

### What we prove

- **Two autonomous agents** (`pnpm agents:e2e`) — exceeds PRD single-agent minimum
- **Signed session mandate** with maxBid / maxEscrow / maxAppraisalSpend
- **x402 appraisal** with on-chain USDC settle
- **10 unit tests** including cap negative scenarios
- Agent commits via **session key**, not principal

### Passkey wallet policy

**Status:** Documented in Passkey tab + `docs/ECOSYSTEM.md`. Mandate caps map to Smart Account context rules / spending policies in production.

### Cap enforcement honesty

| Cap | Layer | Enforced? |
| --- | --- | --- |
| maxBid | Agent (mandate) | Off-chain only |
| maxAppraisalSpend | Agent (mandate) | Off-chain only |
| maxEscrow | Agent + commit tx | Off-chain + public escrow amount |
| bid ≤ escrow | Round contract | **On-chain** at reveal |

UI **Caps** tab and `CAP_SAFETY_COPY` state this explicitly.

### Winner settlement vs x402

**Status:** `SettlementRail` panel + `docs/TECH_DESIGN.md`.

- **x402** = appraisal micro-payment (agent → server)
- **`settle()`** = winner prize (escrow → operator via SAC)

Same USDC asset rail (SEP-41); different authorization. Winner payment is **not** x402 by design — contract-enforced escrow settlement.

---

## Intentional PRD deviation

- **Multi-agent (2 bidders)** instead of PRD's single autonomous agent — stronger
  supporting proof for the Hack Privacy winning primitive.

## Mainnet vs testnet (submission)

| | Testnet | Mainnet |
| --- | --- | --- |
| Full USDC lifecycle | ✅ `lifecycle:e2e` | ❌ not in scope |
| Multi-agent + x402 + settle | ✅ `agents:e2e` (one canonical trace) | ❌ |
| Auditor UI blobs | ✅ from `agents:e2e` → `demo-trace.generated.ts` | ❌ |
| Deploy + BLS + settle | ✅ | ✅ **1/5 XLM smoke** |
| Read-only verify | — | ✅ `pnpm mainnet:verify` |

Mainnet intentionally uses **micro XLM amounts**, never testnet demo sizes (700/459 USDC).

## Demo script

See `docs/DEMO_SCRIPT.md` for jury walkthrough order.
