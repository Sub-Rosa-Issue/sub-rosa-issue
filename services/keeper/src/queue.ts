import { KeeperStore } from "./store.js";

function usage() {
  console.log(`
Usage: npm run queue <command> [args]

Commands:
  add <roundId>      Add a round to the watched queue
  list               List all watched rounds and their status
  remove <roundId>   Remove a round from the queue
`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
  }

  const cmd = args[0];
  const store = new KeeperStore();

  if (cmd === "add") {
    const roundId = args[1];
    if (!roundId) {
      console.error("Error: missing roundId");
      usage();
    }
    const contractId = process.env.ROUND_CONTRACT_ID;
    const network = process.env.NETWORK_PASSPHRASE;
    store.addRound(roundId, { contractId, network });
    console.log(`Added round ${roundId} to the queue.`);
  } else if (cmd === "list") {
    const rounds = store.listRounds();
    if (rounds.length === 0) {
      console.log("Queue is empty.");
      return;
    }
    console.log(`Watching ${rounds.length} rounds:\n`);
    for (const r of rounds) {
      const extra = r.lastAction ? ` (action: ${r.lastAction})` : "";
      const err = r.lastError ? ` (error: ${r.lastError})` : "";
      const contract = r.contractId ? ` [${r.contractId}]` : "";
      console.log(`- Round ${r.roundId}${contract}: ${r.lastStatus}${extra}${err} [retries: ${r.retryCount}]`);
    }
  } else if (cmd === "remove") {
    const roundId = args[1];
    if (!roundId) {
      console.error("Error: missing roundId");
      usage();
    }
    store.removeRound(roundId);
    console.log(`Removed round ${roundId} from the queue.`);
  } else {
    console.error(`Unknown command: ${cmd}`);
    usage();
  }
}

main();
