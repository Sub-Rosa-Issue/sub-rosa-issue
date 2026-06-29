# Keeper Service

The Sub Rosa keeper service is a permissionless TypeScript node application that can run single-shot lifecycle operations or run in watch mode to automatically monitor and drive in-flight rounds to completion.

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
