# Keeper Watch Queue

The keeper watch mode supports a persisted round queue so that a restarted
keeper automatically resumes watching every previously registered round.
The queue is a plain JSON file on disk — safe to inspect and hand-edit.

## Store location

The default path is `keeper-queue.json` in the working directory.
Override it with the `WATCH_QUEUE_FILE` environment variable:

```sh
WATCH_QUEUE_FILE=/var/lib/keeper/queue.json npm run -w services/keeper watch
```

## Store format (version 1)

```json
{
  "version": 1,
  "rounds": [
    {
      "roundId": "42",
      "contractId": "CCONTRACT...",
      "network": "Test SDF Network ; September 2015",
      "revealRound": "1234567",
      "lastStatus": "Revealing",
      "retryCount": 0,
      "lastRetryAt": "2024-06-01T12:00:00.000Z",
      "lastAction": "open",
      "createdAt": "2024-06-01T11:00:00.000Z",
      "updatedAt": "2024-06-01T12:00:00.000Z"
    }
  ]
}
```

### Field reference

| Field | Type | Description |
|---|---|---|
| `version` | number | Format version (currently `1`) |
| `roundId` | string | Round ID stored as a decimal string (BigInt-safe) |
| `contractId` | string | Soroban contract ID (C…) |
| `network` | string | Network passphrase |
| `revealRound` | string | Drand round number, or `"unknown"` if not yet fetched |
| `lastStatus` | string | Last observed on-chain status: `unknown \| Open \| Revealing \| Cleared \| Settled \| Voided` |
| `retryCount` | number | How many times the keeper tick failed for this round |
| `lastRetryAt` | string \| null | ISO 8601 timestamp of the last tick attempt |
| `lastAction` | string \| null | Last action performed: `open \| reveal \| clear \| settle \| void \| null` |
| `createdAt` | string | ISO 8601 timestamp when the entry was first registered |
| `updatedAt` | string | ISO 8601 timestamp of the last modification |

## Commands

All queue management commands print their result and exit immediately
(they do not enter the watch loop).

### Add a round

Register a round for watching. Subsequent watch restarts will include it.
Requires `ROUND_CONTRACT_ID` in the environment.

```sh
ROUND_CONTRACT_ID=C... npm run -w services/keeper watch -- --add-round 42
```

If the round is already registered the command is a no-op and reports the
existing entry's status.

### List all watched rounds

Show every entry in the queue (all contracts and networks).

```sh
npm run -w services/keeper watch -- --list-watched
```

Output example:

```
queue file: keeper-queue.json
watched rounds (2):
  round=1  contract=C...  network=Test SDF Network ; September 2015  status=Settled  revealRound=1000  added=2024-06-01T11:00:00.000Z
  round=2  contract=C...  network=Test SDF Network ; September 2015  status=Open  revealRound=unknown  added=2024-06-01T12:00:00.000Z
```

### Remove a round

Stop watching a specific round. Requires `ROUND_CONTRACT_ID`.

```sh
ROUND_CONTRACT_ID=C... npm run -w services/keeper watch -- --remove-round 42
```

### Prune completed rounds

Remove all `Settled` and `Voided` rounds from the queue.

```sh
npm run -w services/keeper watch -- --prune
```

## Resume behavior

When the keeper starts in watch mode (no management flag), it:

1. Discovers live rounds from the contract (as before).
2. Reads all pending queued rounds for the current `ROUND_CONTRACT_ID`.
3. Merges both sets (deduplicates, sorts by round ID).
4. Runs one watch tick per round, then updates `lastStatus` and `lastAction`
   in the queue.

To disable queue-based resume without deleting the file:

```sh
WATCH_RESUME_QUEUE=false npm run -w services/keeper watch
```

## Handling corruption

If the queue file exists but cannot be parsed (invalid JSON, wrong structure,
permission error), the keeper logs a warning and starts with an **empty** in-
memory queue — it does not crash. The file is only overwritten on the next
successful write (e.g., after `--add-round`).

## Failure scenarios and recovery

| Scenario | Behaviour |
|---|---|
| File missing at startup | Treated as empty queue; created on first write |
| File is invalid JSON | Warning logged; treated as empty queue |
| File has unexpected structure | Warning logged; treated as empty queue |
| Write fails (disk full, permissions) | Exception propagated; watch loop continues for current tick |
| Round registered on wrong contract | No effect — `removeRound` is scoped to contractId |
| Duplicate `--add-round` call | Idempotent — existing entry returned, no duplicate written |

## Typical operator workflow

```sh
# 1. Register rounds to watch
ROUND_CONTRACT_ID=C... npm run -w services/keeper watch -- --add-round 1
ROUND_CONTRACT_ID=C... npm run -w services/keeper watch -- --add-round 2

# 2. Inspect the queue
npm run -w services/keeper watch -- --list-watched

# 3. Start the watch loop (picks up rounds 1 and 2 automatically)
ROUND_CONTRACT_ID=C... KEEPER_SECRET=S... npm run -w services/keeper watch

# 4. After a restart, the loop resumes rounds 1 and 2 without re-registration.

# 5. Remove a round that is no longer needed
ROUND_CONTRACT_ID=C... npm run -w services/keeper watch -- --remove-round 1

# 6. Clean up completed rounds
npm run -w services/keeper watch -- --prune
```
