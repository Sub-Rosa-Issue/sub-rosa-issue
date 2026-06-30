#!/usr/bin/env bash
# Mainnet deploy — upload wasm + deploy Round + createRound + commit smoke.
#
# Usage (secrets via env only — never commit):
#   OPERATOR_SECRET=S… ./packages/sdk/scripts/mainnet-deploy.sh
#
# Account needs ~30+ XLM for wasm upload resource fees on mainnet (see README).
set -euo pipefail

cd "$(dirname "$0")/../../.."
ROOT="$(pwd)"

RPC_URL="${RPC_URL:-https://rpc.ankr.com/stellar_soroban}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"

if [[ -z "${OPERATOR_SECRET:-}" ]]; then
  echo "error: set OPERATOR_SECRET (S…)" >&2
  exit 1
fi

if [[ "${MAINNET_CONFIRM:-}" != "SUB_ROSA_MAINNET" ]]; then
  echo "error: set MAINNET_CONFIRM=SUB_ROSA_MAINNET before mainnet deploy" >&2
  exit 1
fi

BIDDER_SECRET="${BIDDER_SECRET:-$OPERATOR_SECRET}"

echo "→ [build] compiling wasm…"
stellar contract build --out-dir artifacts >/dev/null

echo "→ [upload] installing wasm on mainnet…"
WASM_HASH="$(stellar contract upload \
  --wasm artifacts/sub_rosa_round.wasm \
  --source-account "$OPERATOR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  2>&1 | tail -1)"
echo "    wasm hash: $WASM_HASH"

echo "→ [token] native XLM SAC…"
USDC_SAC="$(stellar contract id asset --asset native --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE")"
stellar contract asset deploy \
  --asset native \
  --source-account "$OPERATOR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" >/dev/null 2>&1 || true

echo "→ [deploy] Round contract + smoke (createRound + commit)…"
OPERATOR_SECRET="$OPERATOR_SECRET" \
BIDDER_SECRET="$BIDDER_SECRET" \
WASM_HASH="$WASM_HASH" \
USDC_SAC="$USDC_SAC" \
RPC_URL="$RPC_URL" \
NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE" \
pnpm --filter @sub-rosa/sdk exec tsx scripts/live-smoke.ts
