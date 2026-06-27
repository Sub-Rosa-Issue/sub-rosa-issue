#!/usr/bin/env bash
# Mainnet settlement for an existing Round — keeper open/reveal + clear/settle.
#
# Usage:
#   KEEPER_SECRET=S… ROUND_CONTRACT_ID=C… ./services/keeper/scripts/mainnet-settle.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."

RPC_URL="${RPC_URL:-https://rpc.ankr.com/stellar_soroban}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"

[[ -n "${KEEPER_SECRET:-}" ]] || { echo "error: KEEPER_SECRET required" >&2; exit 1; }
[[ -n "${ROUND_CONTRACT_ID:-}" ]] || { echo "error: ROUND_CONTRACT_ID required" >&2; exit 1; }

if [[ "${MAINNET_CONFIRM:-}" != "SUB_ROSA_MAINNET" ]]; then
  echo "error: set MAINNET_CONFIRM=SUB_ROSA_MAINNET before mainnet settle" >&2
  exit 1
fi

KEEPER_SECRET="$KEEPER_SECRET" \
ROUND_CONTRACT_ID="$ROUND_CONTRACT_ID" \
ROUND_ID="${ROUND_ID:-1}" \
RPC_URL="$RPC_URL" \
NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE" \
pnpm --filter @sub-rosa/keeper exec tsx scripts/mainnet-settle.ts
