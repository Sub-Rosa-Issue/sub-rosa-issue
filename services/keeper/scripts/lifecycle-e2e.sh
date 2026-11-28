#!/usr/bin/env bash
# Full live testnet lifecycle. Provisions an issuer + operator + 2 bidders +
# keeper, issues a USDC Stellar Asset (trustlines + mint), deploys its SAC, and
# runs the e2e: commit×2 → wait R → open → reveal all → clear → settle → assert
# balances + contract drains to zero → idempotent second pass.
#
# Real network, real Drand beacon, real SAC transfers, no mock. Re-runnable.
set -euo pipefail

cd "$(dirname "$0")/../../.."
NET="${STELLAR_NETWORK:-testnet}"

echo "→ [build] compiling wasm…"
stellar contract build --out-dir artifacts >/dev/null

echo "→ [keys] generating + funding issuer/operator/bidders/keeper on ${NET}…"
for k in lc-issuer lc-op lc-bid1 lc-bid2 lc-keeper; do
  stellar keys generate "$k" --network "$NET" --overwrite >/dev/null 2>&1 || true
  stellar keys fund "$k" --network "$NET" >/dev/null 2>&1
done

ISSUER="$(stellar keys address lc-issuer)"
ASSET="USDC:${ISSUER}"
echo "→ [asset] ${ASSET}"

echo "→ [trustlines+mint] establishing trustlines and minting USDC (via Horizon)…"
ISSUER_SECRET="$(stellar keys show lc-issuer)" \
OPERATOR_SECRET="$(stellar keys show lc-op)" \
BIDDER1_SECRET="$(stellar keys show lc-bid1)" \
BIDDER2_SECRET="$(stellar keys show lc-bid2)" \
ASSET_CODE="USDC" \
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}" \
pnpm --filter @sub-rosa/keeper exec tsx scripts/usdc-setup.ts

echo "→ [sac] deploying the USDC Stellar Asset Contract…"
stellar contract asset deploy --asset "$ASSET" --source lc-issuer --network "$NET" >/dev/null 2>&1 || true
USDC_SAC="$(stellar contract id asset --asset "$ASSET" --network "$NET")"
echo "    USDC SAC: $USDC_SAC"

echo "→ [upload] installing contract wasm…"
WASM_HASH="$(stellar contract upload --wasm artifacts/sub_rosa_round.wasm --source lc-op --network "$NET" 2>/dev/null | tail -1)"
echo "    wasm hash: $WASM_HASH"

echo "→ [e2e] running full lifecycle (waits ~2-4 min across R + reveal deadline)…"
OPERATOR_SECRET="$(stellar keys show lc-op)" \
BIDDER1_SECRET="$(stellar keys show lc-bid1)" \
BIDDER2_SECRET="$(stellar keys show lc-bid2)" \
KEEPER_SECRET="$(stellar keys show lc-keeper)" \
WASM_HASH="$WASM_HASH" \
USDC_SAC="$USDC_SAC" \
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}" \
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}" \
pnpm --filter @sub-rosa/keeper exec tsx scripts/lifecycle-e2e.ts
