#!/usr/bin/env bash
# Live x402 e2e. Provisions issuer + agent(payer) + resource server + facilitator,
# issues a USDC Stellar Asset (trustlines + mint) and its SAC, then runs the e2e:
# unpaid → 402 → signed USDC payment → on-chain settle → appraisal + balance checks.
#
# Real network, real SEP-41 transfer, no mock. Re-runnable.
set -euo pipefail

cd "$(dirname "$0")/../../.."
NET="${STELLAR_NETWORK:-testnet}"

echo "→ [keys] generating + funding issuer/agent/server/facilitator on ${NET}…"
for k in x402-issuer x402-client x402-server x402-facil; do
  stellar keys generate "$k" --network "$NET" --overwrite >/dev/null 2>&1 || true
  stellar keys fund "$k" --network "$NET" >/dev/null 2>&1
done

ISSUER="$(stellar keys address x402-issuer)"
ASSET="USDC:${ISSUER}"
echo "→ [asset] ${ASSET}"

echo "→ [trustlines+mint] agent + resource server trust USDC; mint to agent (via Horizon)…"
ISSUER_SECRET="$(stellar keys show x402-issuer)" \
CLIENT_SECRET="$(stellar keys show x402-client)" \
SERVER_SECRET="$(stellar keys show x402-server)" \
ASSET_CODE="USDC" \
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}" \
pnpm --filter @sub-rosa/appraisal-api exec tsx scripts/usdc-setup.ts

echo "→ [sac] deploying the USDC Stellar Asset Contract…"
stellar contract asset deploy --asset "$ASSET" --source x402-issuer --network "$NET" >/dev/null 2>&1 || true
USDC_SAC="$(stellar contract id asset --asset "$ASSET" --network "$NET")"
echo "    USDC SAC: $USDC_SAC"

echo "→ [e2e] running x402 paid-call lifecycle…"
FACILITATOR_SECRET="$(stellar keys show x402-facil)" \
CLIENT_SECRET="$(stellar keys show x402-client)" \
SERVER_SECRET="$(stellar keys show x402-server)" \
USDC_SAC="$USDC_SAC" \
PRICE="${PRICE:-0.10}" \
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}" \
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}" \
X402_NETWORK="${X402_NETWORK:-stellar:testnet}" \
pnpm --filter @sub-rosa/appraisal-api exec tsx scripts/x402-e2e.ts
