#!/usr/bin/env node
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt, redactReceipt } from "@sub-rosa/sdk";

function usage(): never {
  console.error(`
Usage:
  receipt-cli export <roundId>             Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json>        Verify a local receipt file
  receipt-cli redact <receipt.json> [out]  Redact sensitive fields for public demo

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

async function cmdVerify(path: string) {
  let json: string;
  try {
    json = readFileSync(path, "utf-8");
  } catch (e) {
    console.error(`Cannot read ${path}: ${e}`);
    process.exit(1);
  }

  let receipt;
  try {
    receipt = parseReceipt(json);
  } catch (e) {
    console.error(`Invalid JSON: ${e}`);
    process.exit(1);
  }

  const result = verifyReceipt(receipt);
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

async function cmdRedact(inputPath: string, outputPath?: string) {
  let json: string;
  try {
    json = readFileSync(inputPath, "utf-8");
  } catch (e) {
    console.error(`Cannot read ${inputPath}: ${e}`);
    process.exit(1);
  }

  let receipt;
  try {
    receipt = parseReceipt(json);
  } catch (e) {
    console.error(`Invalid JSON: ${e}`);
    process.exit(1);
  }

  const redacted = redactReceipt(receipt);
  const out = serializeReceipt(redacted);
  const outPath = outputPath ?? inputPath.replace(/\.json$/, ".redacted.json");
  writeFileSync(outPath, out, "utf-8");
  console.log(`Wrote redacted receipt to ${outPath}`);
}

async function main() {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  if (!cmd || !arg) usage();

  switch (cmd) {
    case "export":
      await cmdExport(arg);
      break;
    case "verify":
      await cmdVerify(arg);
      break;
    case "redact":
      await cmdRedact(arg, process.argv[4]);
      break;
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
