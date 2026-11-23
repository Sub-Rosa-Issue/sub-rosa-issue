# Error boundaries

`@sub-rosa/logging/errors` supplies one `NormalizedError` operator model (name,
message, code, cause, stack, retryable, context). It never mutates or replaces the
original domain exception: SDK rethrows and `ErrorOptions.cause` retain class
identity. Catch-and-skip validation branches that do not serialize a caught
value keep their existing control flow.

Use `normalizeError(error, context)` for operator diagnostics and comparisons.
Use `publicError(error)` or `publicErrorMessage(error)` for HTTP and UI boundaries;
these return fixed copy and never forward arbitrary provider prose or context.
`displayError` retains its explicit contract-code guidance before the safe fallback.
Plain objects with a message normalize to that message, consistent with native errors.

Serialization bounds recursive causes and context, handles bigint and cycles,
redacts credential fields and known textual credential forms, and avoids
application-defined getters and toJSON methods. Normalize the complete error tree
at once so secrets discovered in nested causes are redacted from parent messages.

The AST guard detects direct caught-value stringification, interpolation and
message/stack reads, including promise rejection callbacks. Generated contract
bindings and tests are outside its migration scope. Domain type checks and
cause-preserving rethrows are allowed. CI runs the guard and its mutation fixtures.

## Migrated inventory

- `apps/web/src/components/AttackDemo.tsx`
- `apps/web/src/components/AuditorView.tsx`
- `apps/web/src/components/PasskeyPanel.tsx`
- `apps/web/src/hooks/useDashboardData.ts`
- `apps/web/src/hooks/useDrandCountdown.ts`
- `apps/web/src/hooks/useLiveRound.ts`
- `apps/web/src/hooks/useRoundSession.ts`
- `apps/web/src/lib/chain.ts`
- `apps/web/src/lib/demoActions.ts`
- `packages/logging/src/index.cjs`
- `packages/sdk/scripts/live-smoke.ts`
- `packages/sdk/scripts/mainnet-micro.ts`
- `packages/sdk/scripts/mainnet-ready.ts`
- `packages/sdk/scripts/mainnet-verify.ts`
- `packages/sdk/src/asset-config.ts`
- `packages/sdk/src/mainnet-readiness.ts`
- `packages/sdk/src/preflight.ts`
- `packages/tlock/src/auditor-recovery-cli.ts`
- `scripts/check-snapshots.mjs`
- `scripts/run-ts-coverage.mjs`
- `services/agent/scripts/agents-e2e.ts`
- `services/agent/scripts/usdc-setup.ts`
- `services/agent/src/bidder.ts`
- `services/appraisal-api/scripts/usdc-setup.ts`
- `services/appraisal-api/scripts/x402-e2e.ts`
- `services/appraisal-api/src/server.ts`
- `services/auction-template/sealed-auction.ts`
- `services/drand-tools/src/index.ts`
- `services/keeper/scripts/keeper-e2e.ts`
- `services/keeper/scripts/lifecycle-e2e.ts`
- `services/keeper/scripts/mainnet-settle.ts`
- `services/keeper/scripts/usdc-setup.ts`
- `services/keeper/src/keeper.ts`
- `services/keeper/src/queue.ts`
- `services/keeper/src/run.ts`
- `services/keeper/src/serve.ts`
- `services/keeper/src/status-server.ts`
- `services/keeper/src/status.ts`
- `services/keeper/src/store.ts`
- `services/keeper/src/watch-loop.ts`
- `services/keeper/src/watch.ts`
- `services/receipt-cli/src/index.ts`
