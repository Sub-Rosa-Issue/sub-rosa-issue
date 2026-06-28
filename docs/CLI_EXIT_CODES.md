# CLI exit-code contract

This document captures the expected process exit codes for the offline keeper and receipt CLI commands.

## Receipt CLI

- `receipt-cli verify <receipt.json>`
  - exits `0` when the receipt verifies successfully
  - exits `1` for invalid usage, unreadable input, malformed JSON, or verification failure

- `receipt-cli export <roundId>`
  - exits `0` when the receipt is exported successfully
  - exits `1` when required environment configuration is missing or the export fails

## Keeper CLI

- `keeper` / `pnpm --filter @sub-rosa/keeper start`
  - exits `0` for successful dry-run or keeper execution
  - exits `1` when required configuration is missing or the command fails unexpectedly
