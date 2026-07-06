#!/usr/bin/env node
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt, redactReceipt } from "@sub-rosa/sdk";
import { buildJsonOutput } from "./json-output.js";

type CliIo = {
  stdout: Pick<Console, "log">;
  stderr: Pick<Console, "error">;
};

function usage(io: CliIo): number {
  io.stderr.error(`
Usage:
  receipt-cli export <roundId>             Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json>        Verify a local receipt file
  receipt-cli redact <receipt.json> [out]  Redact sensitive fields for public demo

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

async function cmdVerify(path: string, jsonMode: boolean, artifactPath?: string) {
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

  if (artifactPath) {
    let computedChecksum = "";
    try {
      const data = readFileSync(artifactPath);
      computedChecksum = createHash("sha256").update(data).digest("hex");
    } catch (e: any) {
      const message = `Cannot read artifact file: ${e.message}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_artifact_file",
        message,
        path: artifactPath,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    if (!receipt.artifactChecksum) {
      const message = "Missing checksum metadata in receipt";
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_checksum_metadata",
        message,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    if (receipt.artifactChecksum !== computedChecksum) {
      const message = `Checksum mismatch. Expected: ${receipt.artifactChecksum}, computed: ${computedChecksum}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "checksum_mismatch",
        message,
      });
      if (jsonMode) {
        console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const status = result.valid ? "PASS" : "FAIL";
  console.log(`Verification: ${status}`);
  if (artifactPath && result.valid) {
    console.log("Artifact verification: PASS");
  }
  console.log(`Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    io.stdout.log(`  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  return result.valid ? 0 : 1;
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
      const verifyChecksumIdx = args.indexOf("--verify-artifact-checksum");
      let artifactPath: string | undefined = undefined;
      let filteredArgs = [...args];
      if (verifyChecksumIdx !== -1) {
        const nextArg = args[verifyChecksumIdx + 1];
        if (nextArg && !nextArg.startsWith("--")) {
          artifactPath = nextArg;
          filteredArgs.splice(verifyChecksumIdx, 2);
        } else {
          usage();
        }
      }
      const path = filteredArgs.find((a) => !a.startsWith("--"));
      if (!path) usage();
      await cmdVerify(path, jsonMode, artifactPath);
      break;
    }
    case "redact": {
      const arg = process.argv[3];
      if (!arg) usage();
      await cmdRedact(arg, process.argv[4]);
      break;
    }
    default:
      usage();
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
