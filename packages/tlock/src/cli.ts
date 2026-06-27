import * as fs from "node:fs";
import { parseArgs } from "node:util";
import { openIdentity } from "./auditor.js";
import { hexToBytes } from "@noble/hashes/utils.js";

const { values } = parseArgs({
  options: {
    trace: { type: "string" },
    blob: { type: "string" },
    secret: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help || (!values.trace && !values.blob)) {
  console.log(`Usage: npx tsx src/cli.ts [options]

Options:
  --trace <path>    Path to JSON trace or .ts trace file (e.g. demo-trace.generated.ts)
  --blob <hex>      A single auditor blob hex to recover
  --secret <hex>    The auditor's 32-byte secret key (if omitted and --trace is used, it will attempt to read it from the trace itself)
  --help, -h        Show this help
`);
  process.exit(values.help ? 0 : 1);
}

function parseTraceOrJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch (e) {
    // Attempt to extract the JSON object from a TS export like "export const DEMO_TRACE = { ... } as const;"
    const match = content.match(/export\s+const\s+\w+\s*=\s*({[\s\S]*?})\s*(?:as\s+const\s*)?;/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (inner) {
        throw new Error("Found TS object but failed to parse it as strict JSON. " + inner);
      }
    }
    throw new Error("Could not parse file as JSON or canonical TS trace.");
  }
}

async function main() {
  const output = {
    success: true,
    recovered: {} as Record<string, string>,
    errors: {} as Record<string, string>,
  };

  let secretHex = values.secret;
  let blobsToProcess: Record<string, string> = {};

  if (values.trace) {
    try {
      const content = fs.readFileSync(values.trace, "utf-8");
      const trace = parseTraceOrJson(content);
      
      if (!secretHex && trace.auditor?.secretHex) {
        secretHex = trace.auditor.secretHex;
      }

      if (trace.auditor?.blobs) {
        blobsToProcess = trace.auditor.blobs;
      } else {
        output.success = false;
        output.errors["trace"] = "No auditor.blobs found in the trace file.";
      }
    } catch (e) {
      output.success = false;
      output.errors["trace"] = e instanceof Error ? e.message : String(e);
    }
  }

  if (values.blob) {
    blobsToProcess["single-blob"] = values.blob;
  }

  if (!secretHex) {
    output.success = false;
    output.errors["secret"] = "Missing auditor secret key. Provide --secret <hex>";
  } else if (secretHex.length !== 64) {
    output.success = false;
    output.errors["secret"] = "Secret key must be a 64-character hex string (32 bytes).";
  }

  if (Object.keys(blobsToProcess).length === 0 && !output.errors["trace"]) {
    output.success = false;
    output.errors["input"] = "No blobs provided to process.";
  }

  // If no fatal startup errors, attempt recovery
  if (secretHex && secretHex.length === 64) {
    let secretKey: Uint8Array;
    try {
      secretKey = hexToBytes(secretHex);
    } catch (e) {
      output.success = false;
      output.errors["secret"] = "Invalid hex in secret key.";
      secretKey = new Uint8Array(0); // Dummy to satisfy compiler, execution stops conceptually below
    }

    if (secretKey.length === 32) {
      for (const [id, blobHex] of Object.entries(blobsToProcess)) {
        try {
          const blobBytes = hexToBytes(blobHex);
          const identityBytes = openIdentity(blobBytes, secretKey);
          const identityStr = new TextDecoder().decode(identityBytes);
          output.recovered[id] = identityStr;
        } catch (e) {
          output.success = false;
          output.errors[id] = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }

  // Final structured output
  console.log(JSON.stringify(output, null, 2));
  
  if (!output.success) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, errors: { fatal: err.message } }, null, 2));
  process.exit(1);
});
