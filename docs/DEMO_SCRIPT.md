# Jury Demo Script (~5 minutes)

Walkthrough for `pnpm web:dev` (default http://localhost:5173).

## Canonical trace health check

Before running or deploying the recorded evidence view, verify that its
generated trace still contains every field required by the UI:

```bash
pnpm web:test
```

The check runs locally without network access. If it reports a missing field,
regenerate `apps/web/src/demo/demo-trace.generated.ts` from the canonical agent
flow, then run the check again:

```bash
pnpm agents:e2e
pnpm web:test
```

## Primary narrative: verifiable grant allocation

Open the **Grant Allocation** case first. Frame the product as allocation
infrastructure, not as a general privacy app:

1. Five projects enter a grant round.
2. Three judges submit sealed scores.
3. No judge or operator can read scores before reveal.
4. Drand opens the final scoring set at the shared reveal time.
5. Soroban settles the result/refunds deterministically.
6. The organizer can publish a verifiable round receipt.

The current live case proves the sealed-scoring primitive. The recorded
evidence view proves the contract lifecycle, settlement, and public audit path.

## 1. Showcase (30s)

- **Opening:** verifiable allocation for grants, hackathons, bounties, RFPs,
  and sealed auctions
- **Mainnet proof card:** settled round 1 on real XLM (link to stellar.expert)
- **Drand chip:** live countdown to recorded testnet R (from `demo-trace.generated.ts`)

## 2. Seal Attack (45s)

- Click **Run live comparison**
- **Seal-off:** plaintext "bid" readable immediately — broken baseline
- **Seal-on:** tlock ciphertext — undecryptable until R
- Point: operator cannot read sealed bids early

## 3. Flow (30s)

- Lifecycle timeline: create → commit → wait R → open → reveal → clear → settle
- Drand banner shows R status
- Settlement stats: contract balance → 0

## 4. Agents + x402 (60s)

- Position this as supporting proof for the Hack Privacy winning primitive.
- Two agents with principals vs session keys
- x402 log: 0.10 USDC appraisal settled on-chain
- **Settlement rails panel:** x402 (appraisal) vs SAC settle() (winner prize) — same USDC, different paths
- Keeper steps: wait R → BLS verify → reveal all → clear → settle

## 5. Observer (20s)

- Public table: escrow + revealed bids after R
- Note: identities still auditor-encrypted
- For public demos, generate a redacted receipt to share without leaking participant identities:
  ```bash
  pnpm --filter @sub-rosa/receipt-cli receipt redact round-1-receipt.json
  ```

## 6. Auditor (60s)

- Pre-filled demo auditor secret
- **Decrypt identity blobs** → `agent:G…` for each bidder
- **Run live bid decrypt** → tlock open against published quicknet R
- Explain selective disclosure: values public, names auditor-only

## 7. Caps (30s)

- Off-chain mandate vs on-chain escrow cap
- **Run negative cap scenarios** — unit-test outcomes in browser

## 8. Passkey (30s, optional)

- **This build:** agents use Ed25519 session mandates — not Passkey-signed commits
- **Passkey tab:** real WebAuthn **Create passkey** (testnet WASM baked in); optional deploy smart wallet
- **Production path (documented, not implemented):** Smart Account Kit + optional OZ Relayer for fee sponsorship
- See `docs/ECOSYSTEM.md` for mapping mandate → smart-account policy

## Optional: live contract poll

Set in `apps/web/.env.local` (or hosting build env — see `docs/DEPLOY.md`):

```
VITE_CONTRACT_ID=CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y
VITE_ROUND_ID=1
VITE_RPC_URL=https://soroban-testnet.stellar.org
```

Toggle **Poll live contract** on Showcase.

## CLI proof (if asked)

```bash
pnpm lifecycle:e2e
pnpm agents:e2e
pnpm mainnet:verify
pnpm keeper:watch
```

## Docs for judges

- [TECH_DESIGN.md](./TECH_DESIGN.md)
- [THREAT_MODEL.md](./THREAT_MODEL.md)
- [TRACK_ANSWERS.md](./TRACK_ANSWERS.md)
- [ECOSYSTEM.md](./ECOSYSTEM.md)
