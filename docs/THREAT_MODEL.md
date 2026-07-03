# Sub Rosa — Threat Model

## Assets

| Asset | Location | Sensitivity |
| --- | --- | --- |
| Bid value | Ciphertext (temporary storage) until R | High — market impact if early |
| Bid commitment H | On-chain persistent | Medium — binding once committed |
| Escrow | On-chain persistent | High — funds at stake |
| Bidder identity | Auditor blob (temporary) | Medium — selective disclosure |
| Drand round R | Round record | Public — coordination clock |
| Session mandate | Off-chain agent | Medium — caps delegation |
| Principal key | Off-chain | Critical — not used on-chain in agent flow |

## Adversaries

1. **Operator** — wants to learn bids early or bias clearing
2. **Competing bidder** — wants rival bids before R
3. **Keeper** — could censor reveals (liveness, not secrecy after R)
4. **Appraisal server** — could overcharge or return biased valuations
5. **Malicious agent** — tries to exceed mandate caps
6. **Auditor** — learns identities; must not learn bids before R if honest protocol followed

## Protections

### Early bid disclosure (operator / competitor)

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Read ciphertext before R | tlock IBE — needs Drand round-R sig | None if Drand honest |
| Operator skips reveal | Permissionless `open_reveal` + keeper | Liveness relies on someone running keeper |
| Selective reveal one bid | Contract allows reveal-all; keeper reveals every seal | Keeper could delay but not permanently hide after R |

### Binding and fairness

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Bid change after commit | Commitment H binds value+nonce | Overwrite allowed before deadline — by design |
| Invalid high bid | `valid = value ≤ escrow` excludes from clearing | Escrow still locked until settle |
| Wrong clearing | Deterministic rule in contract | Operator sets rule at create_round |

### Funds

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Winner doesn't pay | Escrow locked at commit; settle pulls from escrow | Requires valid reveal |
| Drand never delivers R | `void` after grace refunds all escrow | Grace window must be configured |
| Double settle | Idempotent settle skips settled bids | Proven in e2e |

### Identity privacy

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Public learns bidder names | Identity only in auditor blob | Values public after reveal by design |
| Wrong auditor reads blob | X25519 AEAD to round auditor pubkey | Auditor key compromise exposes identities |

### Agent / mandate

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Agent exceeds maxBid | Off-chain `assertBidWithinMandate` | **Not Soroban-enforced** — rogue agent could commit higher if funded |
| Agent overpays appraisal | `maxAppraisalSpend` off-chain | Same — requires honest agent code |
| Stolen session key | Caps limit damage to one round/mandate | Principal should rotate; passkey policies in production |

### Receipt verification

`@sub-rosa/sdk`'s offline `verifyReceipt` checks the canonical JSON export
against the round's commitments, clearing rule, and declared winner. The full
schema and verifier surface lives in `docs/RECEIPTS.md`; this subsection only
captures the threat-model-relevant surface.

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Forged receipt | Verifier recomputes `sha256(be16(value) ‖ nonce)` against the stored commitment for every revealed bid; winner is derived from a deterministic clearing rule, not trusted from the exporter | Exporter can still lie about on-chain facts the receipt does not bind to (see `docs/LIMITATIONS.md`); consumers should cross-check against current ledger state |
| Tampered passphrase | `networkFingerprint = sha256(utf8(network))` is embedded in the receipt, so editing the claimed network invalidates the fingerprint | Operationally annoying but bounded — valid `null` ciphertext/auditorBlob after expiry is reported as a warning, not a failure |
| Recycled / replayed receipt | Receipts are versioned (`version: 1`) and status-bound (`Cleared` / `Settled` / `Voided`); receipts are exported with the on-chain state at the time of export | A receipt from a later status can be presented as evidence of an earlier state — re-export and reconcile before relying on a receipt for high-value disputes |
| Single-exporter trust | Anyone can re-export the same round from the RPC and diff; idempotent `settle` skips already-settled bids, so two honest exporters always converge | Forensic, not automatic — see SCF/Wave diligence guidance in `docs/PILOT_PLAYBOOK.md` |

## Trust assumptions

1. **Drand quicknet** — honest threshold signing, public randomness
2. **Soroban host BLS** — correct implementation of BLS12-381 verify
3. **tlock-js / noble crypto** — correct seal/open implementation (tested)
4. **Agent software** — enforces mandate caps before submit
5. **USDC SAC** — standard SEP-41 behavior

## Out of scope (honest limits)

- Mandate caps are **not** enforced in the Round contract
- x402 appraisal price is not on-chain
- Passkey-Kit wallet demo is wired, but agent mandate enforcement is not moved to Passkey policies
- OZ Relayer Channels adapter is optional; direct RPC remains the proven critical path

## Auditor UI

The web **Auditor** tab demonstrates:

- Decrypting identity blobs with auditor secret (X25519)
- Live bid tlock decrypt after R via quicknet

This matches the selective-disclosure story: values public post-R, identities auditor-only.
