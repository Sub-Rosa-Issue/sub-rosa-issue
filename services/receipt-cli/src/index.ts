#!/usr/bin/env node
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt } from "@sub-rosa/sdk";

type CliIo = {
  stdout: Pick<Console, "log">;
  stderr: Pick<Console, "error">;
};

function usage(io: CliIo): number {
  io.stderr.error(`
Usage:
  receipt-cli export <roundId>             Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json>        Verify a local receipt file

Environment for "export":
  RPC_URL                  Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE       Network passphrase (default: Test SDF Network ; September 2015)
  CONTRACT_ID              Round contract ID (C…)
`);
  return 1;
}

async function cmdExport(roundIdStr: string, env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const roundId = BigInt(roundIdStr);
  const rpcUrl = env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const contractId = env.CONTRACT_ID;
  if (!contractId) {
    io.stderr.error("CONTRACT_ID env var is required for export");
    return 1;
  }

  const client = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });
  const receipt = await client.exportReceipt(roundId);
  const json = serializeReceipt(receipt);
  const filename = `round-${roundId}-receipt.json`;
  writeFileSync(filename, json, "utf-8");
  io.stdout.log(`Wrote ${filename}`);
  return 0;
}

async function cmdVerify(path: string, io: CliIo): Promise<number> {
  let json: string;
  try {
    json = readFileSync(path, "utf-8");
  } catch (e) {
    io.stderr.error(`Cannot read ${path}: ${e}`);
    return 1;
  }

  let receipt;
  try {
    receipt = parseReceipt(json);
  } catch (e) {
    io.stderr.error(`Invalid JSON: ${e}`);
    return 1;
  }

  const result = verifyReceipt(receipt);
  const status = result.valid ? "PASS" : "FAIL";
  io.stdout.log(`Verification: ${status}`);
  io.stdout.log(`Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    io.stdout.log(`  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  return result.valid ? 0 : 1;
}

export async function runReceiptCli(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = { stdout: console, stderr: console },
): Promise<number> {
  const [cmd, arg] = args;
  if (!cmd || !arg) return usage(io);

  try {
    switch (cmd) {
      case "export":
        return await cmdExport(arg, env, io);
      case "verify":
        return await cmdVerify(arg, io);
      default:
        return usage(io);
    }
  } catch (err) {
    io.stderr.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function main() {
  const exitCode = await runReceiptCli();
  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
