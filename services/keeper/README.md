<!-- SPDX-License-Identifier: MIT -->
# Keeper Service

The Sub Rosa keeper service is a permissionless TypeScript node application that can run single-shot lifecycle operations or run in watch mode to automatically monitor and drive in-flight rounds to completion. A built-in status HTTP API exposes keeper-observed round state for pilots and dashboards.

## Quick start

```bash
pnpm install
pnpm --filter @sub-rosa/keeper run watch
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run start` | One-shot keep: open + reveal a single round |
| `npm run watch` | Long-running watch mode (poll + act on in-flight rounds) |
| `npm run serve` | Watch mode **plus** the status HTTP API in one process |
| `npm run queue add N` | Add a round to the persisted watch queue |
| `npm run queue list` | List tracked rounds and their latest status |
| `npm run queue remove N` | Remove a round from the queue |
| `npm run queue claim N` | Take the exclusive lease on a round |
| `npm run queue release N` | Give back a lease this owner holds |

## Status HTTP API

The status API is served by `npm run serve` (or any process that calls `createStatusServer()`). It is **read-only** — it inspects on-chain state via the same `SubRosaClient` the watch loop uses, and serves the persisted store as stable JSON. No signing material, no secrets.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Full status: all tracked rounds, health, uptime |
| `GET` | `/status/rounds/:id` | Single-round status view |
| `GET` | `/status/health` | Health only (RPC + Drand) |
| `GET` | `/healthz` | Liveness probe — cheap, suitable for load balancers |
| `GET` | `/` | Service info + endpoint list |

### Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `KEEPER_STATUS_HOST` | `127.0.0.1` | Bind address for the status API |
| `KEEPER_STATUS_PORT` | `8090` | Port for the status API |
| `KEEPER_STATUS_ENABLE` | `true` | Set to `false` to disable the status API in `serve` |

### Example

```bash
KEEPER_STATUS_PORT=8090 npm run serve
curl http://127.0.0.1:8090/status | jq .
```

Response shape (typed in `@sub-rosa/sdk` as `KeeperStatusResponse`):

```json
{
  "contractId": "C...",
  "network": "Test SDF Network ; September 2015",
  "uptimeSeconds": 42,
  "rounds": [
    {
      "roundId": "1",
      "status": "Open",
      "phase": "awaiting-drand",
      "nextAction": "open reveal when the configured Drand round is published",
      "commitDeadline": 1767043200,
      "revealDeadline": 1767046800,
      "revealRound": 100,
      "revealReady": false,
      "commitClosed": false,
      "revealWindowOpen": false,
      "voidableAfter": 1767050400,
      "bidderCount": 2,
      "revealedCount": null,
      "winner": null,
      "winningValue": null,
      "clearingRule": "HighestBid",
      "settlement": "none",
      "guardSkip": null,
      "guardSkipIndicator": null,
      "lastKeeperAction": null,
      "lastError": null,
      "retryCount": 0,
      "updatedAt": "2026-06-29T15:30:00.000Z"
    }
  ],
  "health": { "rpc": "ok", "drand": "ok", "checkedAt": "..." },
  "now": "..."
}
```

### Round status fields

- `status`: on-chain lifecycle (`Unknown | Open | Revealing | Cleared | Settled | Voided | NotFound`).
- `phase`: keeper-actionable phase (`awaiting-drand | stale-open | revealing | awaiting-clear | ready-to-clear | ready-to-settle | complete`).
- `revealReady`: `true` when the keeper could open the reveal window on the next tick (Drand round R published).
- `commitClosed`, `revealWindowOpen`: wall-clock flags derived from `commit_deadline` / `reveal_deadline`.
- `voidableAfter`: unix seconds after which a still-Open round can be voided (reveal_deadline + 3600s grace).
- `bidderCount`, `revealedCount`: from the on-chain bidder index / bid states; `null` when unreachable.
- `settlement`: `pending | submitted | terminal | none` — reflects the in-memory settlement guard.
- `guardSkip`: the typed reason the settlement guard last refused a submission for this round, or `null`. Shape: `{ action, reason, detail, at }` where `reason` is one of `already_settled | round_voided | not_cleared | missing_winner | bidder_page_incomplete | refund_missing | winner_mismatch | void_not_open | void_grace_not_elapsed`. It is set only when the keeper looked at a settle or a void and did **not** submit it because the round contract would have rejected the transaction (or the local view could not prove the refund set).
- `guardSkipIndicator`: `"<action> refused: <reason>"` — the same refusal, flattened for logs and dashboards.
- `lastKeeperAction`: human-readable summary of the last mutation the keeper performed for this round.
- `lastError`, `retryCount`: tick failure tracking.

### Health

- `/healthz` returns `200` only when both RPC and Drand respond. Any error → `503`. Cheap enough for a liveness probe.
- `/status/health` returns the same health shape plus a timestamp, but runs the full round-building pass (more RPC load — use for readiness, not liveness).

## Pilot deployment notes

1. **Run `serve`, not `watch`, in production.** The combined process gives you the status API alongside the keeper loop. Both share the same RPC budget and the same persisted store.
2. **Bind the status API to a private interface** (`KEEPER_STATUS_HOST=127.0.0.1` or an internal container network). It is read-only but reveals which rounds the keeper is tracking.
3. **Put a reverse proxy (nginx, Caddy) in front** if you need TLS or auth. The status API itself performs no auth — pilots and dashboards should be on a trusted network or behind an auth proxy.
4. **Poll `/healthz` from your orchestrator** for liveness. Poll `/status` for dashboards. Do not hammer `/status` faster than the keeper's poll interval (`WATCH_POLL_MS`, default 15s) — the response is built on-demand from on-chain state.
5. **The status API does not require `KEEPER_SECRET`.** It only reads on-chain state. If you run the keeper in a separate process from the status API, give the status process a read-only `SubRosaClient` (no `secretKey`).
6. **Failure states are visible, not hidden.** A round whose on-chain lookup fails is surfaced with `status: "Unknown"` or `status: "NotFound"` and the `lastError` field populated. The process does not crash on upstream errors.
7. **Secrets in responses: none.** The status API never emits secret keys, signed transactions, or bidder private data. Bidder *addresses* (public on-chain identifiers) are included so dashboards can show bidder counts.

## Watch Checkpoint (restart safety)

The in-memory settlement guard is lost on restart. The **watch checkpoint** is the durable version: a small local JSON file (default `.keeper-checkpoint.json`, override with `KEEPER_CHECKPOINT_PATH`) that records how far each round got, so a crash after a confirmed reveal, clear, or settle does not broadcast that step again.

### Checkpoint format

```json
{
  "version": 1,
  "network": "Test SDF Network ; September 2015",
  "contractId": "C...",
  "rounds": {
    "1": {
      "roundId": "1",
      "completedSteps": ["open-reveal", "reveal", "clear", "settle"],
      "lastCompletedStep": "settle",
      "lastTransactionHash": "0x…",
      "stepHashes": { "settle": "0x…" },
      "updatedAt": "2026-09-30T00:00:00.000Z"
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `network` / `contractId` | The deployment the cursor was recorded for. |
| `completedSteps` | Steps observed complete, in completion order. |
| `lastCompletedStep` | The cursor position — the last step this process finished. |
| `lastTransactionHash` | Transaction hash of the last step, when the SDK exposes one. |
| `stepHashes` | Per-step hashes, re-verified on every startup. |
| `updatedAt` | ISO-8601 timestamp of the last write. |

Steps tracked: `open-reveal`, `reveal`, `clear`, `settle`, `void`.

### Startup validation

1. **Binding.** If `network` or `contractId` on disk does not match the process configuration, the keeper refuses to start (`KeeperCheckpointMismatchError`) instead of replaying a cursor from another deployment. Point `KEEPER_CHECKPOINT_PATH` at a per-deployment file, or delete the file when you switch networks.
2. **Hash verification.** Every recorded `stepHashes` entry is re-checked (when a verifier is wired in). A hash that comes back `failed` or `missing` is rolled back so the step is retried; a `confirmed` hash is trusted even if the RPC replica still reports the pre-step status.
3. **Chain reconciliation.** Cursor entries with no hash to verify are checked against the on-chain status. If the chain cannot prove the step happened, the entry is dropped rather than stranding the round.

`open-reveal` is recorded but never used to skip work: whether the reveal window is open is already authoritative on-chain, and trusting the cursor there could strand an Open round. An unreadable or corrupted checkpoint file is backed up (`*.corrupted.<ts>`) and the keeper starts from a fresh cursor rather than guessing.

### In-flight transaction recovery

The keeper also uses a separate durable submission journal (default `.keeper-submissions.json`, override with `KEEPER_SUBMISSION_PATH`). The SDK writes the hash, operation, round, network, submission time, and expiry before the RPC send call. On restart, the keeper polls a pending hash before constructing a replacement transaction. Confirmed hashes are recorded in the completion checkpoint; definitive failures stop the pass; expired hashes permit one replacement. The journal stores no signed XDR or secret key and refuses to open under a different network or contract binding.

### Dry-run

`KEEPER_DRY_RUN=true npm run start` prints the checkpoint it *would* write — path, binding, proposed step, and the exact file content — inside the dry-run summary. It submits no transactions (`transactionsSubmitted: 0`) and writes nothing (`checkpoint.filesWritten: 0`). If the existing checkpoint would block a live run, the summary reports it as `checkpoint.mismatch` (`network` or `contractId`).

## Persisted Queue / Store

## Persisted Queue / Store

In watch mode, the keeper maintains a small local JSON store (by default `.keeper-store.json`) to remember which rounds it is tracking across restarts. The store allows the keeper to survive container restarts and resume watching exactly where it left off.

### Store Format

The store file is a plain JSON file, making it safe and easy for operators to inspect or modify manually if necessary.

```json
{
  "rounds": {
    "1": {
      "roundId": "1",
      "contractId": "CAPTODBCDE...",
      "network": "Test SDF Network ; September 2015",
      "lastStatus": "Open",
      "retryCount": 0,
      "lastError": "Some optional error text",
      "lastAction": "opened, revealed×2"
    }
  }
}
```

- `lastStatus`: The on-chain status observed during the last tick (e.g. `Open`, `Revealing`, `Settled`, `Voided`).
- `lastAction`: A human-readable summary of the mutations performed by the keeper (e.g. `opened`, `voided`).
- `retryCount`: How many consecutive times the keeper tick threw an exception for this round.

### Consuming the status API from TypeScript

The `@sub-rosa/sdk` package ships typed response shapes and a tiny fetch client:

```ts
import { KeeperStatusClient } from "@sub-rosa/sdk";

const client = new KeeperStatusClient({ baseURL: "http://127.0.0.1:8090" });
const status = await client.getStatus();
for (const round of status.rounds) {
  logger.info("round-status", "round status", { roundId: round.roundId.toString(), status: round.status, phase: round.phase });
}
```

The client throws `StatusApiError` on non-2xx responses and parses the stable JSON shapes (`KeeperStatusResponse`, `KeeperRoundStatusView`, `KeeperHealthResponse`) defined in `@sub-rosa/sdk`.

### Completed Round Cleanup
The watch loop automatically filters out rounds with a `lastStatus` of `"Settled"` or `"Voided"`. These completed rounds remain in the JSON file for historical audit logs but are practically "pruned" from active RPC polling to save resources. If you want to delete them entirely, use the CLI.

### CLI Queue Management

You can manage the queue explicitly via the included CLI:

```bash
# Add a round to watch (inherits contract and network from ENV)
npm run queue add 42

# List all watched rounds, their statuses, retry metrics, and any lease
npm run queue list

# Stop watching a round and delete it from the store
npm run queue remove 42

# Take the round's lease (owner comes from KEEPER_OWNER, default queue-cli-<pid>)
npm run queue claim 42

# Give the round back (only the owning KEEPER_OWNER may release it)
npm run queue release 42
```

## Exclusive round leases

Two keeper processes pointed at the same `KEEPER_STORE_PATH` must never reveal
or settle the same round at the same time. Before it ticks a round, the watch
loop claims an exclusive lease that is persisted in the store next to the
queue:

```json
{
  "owner": "keeper-4242-1f0d…",
  "roundId": "42",
  "network": "Test SDF Network ; September 2015",
  "contractId": "C…",
  "expiresAtMs": 1788060000000
}
```

- A claim is refused while a **live** lease for the same round, contract, and
  network is held by a different owner; the losing watcher skips the tick
  instead of submitting alongside the winner. A lease recorded for one contract
  id never blocks another contract's round.
- The lease is released only when the step reaches a terminal success
  (`Settled` / `Voided`) or a definitive contract failure. A transient failure
  — a dropped RPC connection, a timeout — keeps the lease so the same owner
  retries the round on the next tick.
- Leases expire on the injected clock, so a crashed owner stops locking the
  round after `KEEPER_LEASE_MS`. The expired lease can then be claimed again,
  once, by the next watcher.

| Env var | Default | Description |
|---------|---------|-------------|
| `KEEPER_OWNER` | generated per run | Lease owner id for this process. Set it to a stable value when you run the queue CLI against a live watcher's store. |
| `KEEPER_LEASE_MS` | `120000` | Round lease duration in milliseconds. |
