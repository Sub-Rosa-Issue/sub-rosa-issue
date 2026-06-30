#!/usr/bin/env bash
# Consolidated mainnet launch readiness — read-only by default.
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm --filter @sub-rosa/sdk exec tsx scripts/mainnet-ready.ts "$@"
