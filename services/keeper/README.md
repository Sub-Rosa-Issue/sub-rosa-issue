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
  console.log(round.roundId, round.status, round.phase);
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

# List all watched rounds, their statuses, and retry metrics
npm run queue list

# Stop watching a round and delete it from the store
npm run queue remove 42
```
