#!/usr/bin/env node
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt } from "@sub-rosa/sdk";
import { buildJsonOutput } from "./json-output.js";

function usage(): never {
  console.error(`
Usage:
  receipt-cli export <roundId>                  Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json>             Verify a local receipt file
  receipt-cli verify <receipt.json> --json      Output verification result as JSON

Environment for "export":
  RPC_URL                  Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE       Network passphrase (default: Test SDF Network ; September 2015)
  CONTRACT_ID              Round contract ID (C…)
`);
  process.exit(1);
}

async function cmdExport(roundIdStr: string) {
  const roundId = BigInt(roundIdStr);
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    console.error("CONTRACT_ID env var is required for export");
    process.exit(1);
  }

  const client = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });
  const receipt = await client.exportReceipt(roundId);
  const json = serializeReceipt(receipt);
  const filename = `round-${roundId}-receipt.json`;
  writeFileSync(filename, json, "utf-8");
  console.log(`Wrote ${filename}`);
}

async function cmdVerify(path: string, jsonMode: boolean) {
  let rawJson: string;
  try {
    rawJson = readFileSync(path, "utf-8");
  } catch (e) {
    if (jsonMode) {
      console.log(JSON.stringify(buildJsonOutput(null, null, `Cannot read file: ${e}`), null, 2));
    } else {
      console.error(`Cannot read ${path}: ${e}`);
    }
    process.exit(1);
  }

  let receipt;
  try {
    receipt = parseReceipt(rawJson);
  } catch (e) {
    if (jsonMode) {
      console.log(JSON.stringify(buildJsonOutput(null, null, `Invalid JSON: ${e}`), null, 2));
    } else {
      console.error(`Invalid JSON: ${e}`);
    }
    process.exit(1);
  }

  const result = verifyReceipt(receipt);

  if (jsonMode) {
    console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const status = result.valid ? "PASS" : "FAIL";
  console.log(`Verification: ${status}`);
  console.log(`Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    console.log(`  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  process.exit(result.valid ? 0 : 1);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) usage();

  switch (cmd) {
    case "export": {
      const arg = process.argv[3];
      if (!arg) usage();
      await cmdExport(arg);
      break;
    }
    case "verify": {
      const args = process.argv.slice(3);
      const jsonMode = args.includes("--json");
      const path = args.find((a) => !a.startsWith("--"));
      if (!path) usage();
      await cmdVerify(path, jsonMode);
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
