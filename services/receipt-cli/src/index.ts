#!/usr/bin/env node
import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, writeData } from '@sub-rosa/logging';
const diagnostics = createLogger("services.receipt-cli.src.index");
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync, renameSync, statSync, existsSync, constants, openSync, closeSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt, redactReceipt } from "@sub-rosa/sdk";
import { systemClock } from "@sub-rosa/time";
import { buildJsonOutput } from "./json-output.js";

const MAX_OUTPUT_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB

function usage(): never {
  diagnostics.error("usage-receipt-cli-export-roundid-fetch-receipt-from-rpc", `
Usage:
  receipt-cli export <roundId> [--force]     Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json> [--json] [--verify-artifact-checksum <artifact-file>]
  receipt-cli redact <receipt.json> [out] [--force]  Redact sensitive fields for public demo

Options for "verify":
  --json                                  Print machine-readable verification output
  --verify-artifact-checksum <artifact-file>
                                          Verify the checksum of the required artifact file

Options for "export" and "redact":
  --force                                 Overwrite existing non-empty output file

Environment for "export":
  RPC_URL                  Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE       Network passphrase (default: Test SDF Network ; September 2015)
  CONTRACT_ID              Round contract ID (C…)
`);
  process.exit(1);
}

function writeFileAtomic(filePath: string, data: string, force: boolean): void {
  // Check if file exists and is non-empty
  if (existsSync(filePath)) {
    const stats = statSync(filePath);
    if (stats.size > 0 && !force) {
      throw new Error(`Output file "${filePath}" exists and is not empty. Use --force to overwrite.`);
    }
    if (stats.size > MAX_OUTPUT_FILE_SIZE) {
      throw new Error(`Output file "${filePath}" exceeds maximum allowed size of ${MAX_OUTPUT_FILE_SIZE} bytes.`);
    }
  }

  // Write to temporary file first
  const tempPath = `${filePath}.tmp.${process.pid}.${systemClock.nowMs()}`;
  try {
    // Write with owner-only permissions (0o600)
    const fd = openSync(tempPath, 'w', 0o600);
    writeSync(fd, data, 0, 'utf-8');
    closeSync(fd);

    // Atomic rename
    renameSync(tempPath, filePath);
  } catch (e) {
    // Clean up temp file on error
    try { unlinkSync(tempPath); } catch {}
    throw e;
  }
}

async function cmdExport(roundIdStr: string, force: boolean) {
  const roundId = BigInt(roundIdStr);
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    diagnostics.error("contract-id-env-var-is-required-for-export", "CONTRACT_ID env var is required for export");
    process.exit(1);
  }

  const client = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });
  const receipt = await client.exportReceipt(roundId);
  const json = serializeReceipt(receipt);
  const filename = `round-${roundId}-receipt.json`;
  writeFileAtomic(filename, json, force);
  diagnostics.info("wrote", `Wrote ${filename}`);
}

async function cmdVerify(path: string, jsonMode: boolean, artifactPath?: string) {
  let rawJson: string;
  try {
    rawJson = readFileSync(path, "utf-8");
  } catch (e) {
    if (jsonMode) {
      writeData(JSON.stringify(buildJsonOutput(null, null, {
        code: "parse_error",
        message: `Cannot read file: ${normalizeError(e).message}`,
      }), null, 2));
    } else {
      diagnostics.error("cannot-read", `Cannot read ${path}: ${normalizeError(e).message}`);
    }
    process.exit(1);
  }

  let receipt;
  try {
    receipt = parseReceipt(rawJson);
  } catch (e) {
    if (jsonMode) {
      writeData(JSON.stringify(buildJsonOutput(null, null, {
        code: "parse_error",
        message: `Invalid JSON: ${normalizeError(e).message}`,
      }), null, 2));
    } else {
      diagnostics.error("invalid-json", `Invalid JSON: ${normalizeError(e).message}`);
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
      const message = `Cannot read artifact file: ${normalizeError(e).message}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_artifact_file",
        message,
        path: artifactPath,
      });
      if (jsonMode) {
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error", `Error: ${message}`);
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
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error-2", `Error: ${message}`);
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
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error-3", `Error: ${message}`);
      }
      process.exit(1);
    }
  }

  if (jsonMode) {
    writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const status = result.valid ? "PASS" : "FAIL";
  diagnostics.info("verification", `Verification: ${status}`);
  if (artifactPath && result.valid) {
    diagnostics.info("artifact-verification-pass", "Artifact verification: PASS");
  }
  diagnostics.info("computed-winner", `Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    diagnostics.info("progress-7", `  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  process.exit(result.valid ? 0 : 1);
}

async function cmdRedact(inputPath: string, outputPath?: string, force: boolean = false) {
  let json: string;
  try {
    json = readFileSync(inputPath, "utf-8");
  } catch (e) {
    diagnostics.error("cannot-read-2", `Cannot read ${inputPath}: ${normalizeError(e).message}`);
    process.exit(1);
  }

  let receipt;
  try {
    receipt = parseReceipt(json);
  } catch (e) {
    diagnostics.error("invalid-json-2", `Invalid JSON: ${normalizeError(e).message}`);
    process.exit(1);
  }

  const redacted = redactReceipt(receipt);
  const out = serializeReceipt(redacted);
  const outPath = outputPath ?? inputPath.replace(/\.json$/, ".redacted.json");
  writeFileAtomic(outPath, out, force);
  diagnostics.info("wrote-redacted-receipt-to", `Wrote redacted receipt to ${outPath}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) usage();

  switch (cmd) {
    case "export": {
      const args = process.argv.slice(3);
      const force = args.includes("--force");
      const filteredArgs = args.filter(a => a !== "--force");
      const arg = filteredArgs[0];
      if (!arg) usage();
      await cmdExport(arg, force);
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
      const args = process.argv.slice(3);
      const force = args.includes("--force");
      const filteredArgs = args.filter(a => a !== "--force");
      const arg = filteredArgs[0];
      if (!arg) usage();
      await cmdRedact(arg, filteredArgs[1], force);
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  diagnostics.error("progress-8", normalizeError(e));
  process.exit(1);
});