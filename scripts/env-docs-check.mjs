#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".tsbuildinfo", "artifacts"]);
const SRC_DIRS = ["packages", "services", "apps"];

const ENV_PATTERNS = [
  /process\.env\.(\w+)/g,
  /process\.env\[\s*['"](\w+)['"]\s*\]/g,
  /import\.meta\.env\.(\w+)/g,
  /(?:reqEnv|requiredEnv|optionalEnv|parseStroops)\(\s*(?:env\s*,\s*)?['"](\w+)['"]/g,
  /env\.([A-Z][A-Z_0-9]+)/g,
];

const ALLOWLIST = {
  "OZ_RELAYER_CHANNELS_URL": "backward-compat alias for OZ_CHANNELS_BASE_URL",
  "OZ_RELAYER_API_KEY": "backward-compat alias for OZ_CHANNELS_API_KEY",
  "CONTRACT_ID": "alias for ROUND_CONTRACT_ID used by receipt-cli",
  "OPERATOR_SECRET": "e2e/mainnet script — documented inline in script headers",
  "BIDDER_SECRET": "e2e/mainnet script — documented inline",
  "BIDDER1_SECRET": "e2e lifecycle script — documented inline",
  "BIDDER2_SECRET": "e2e lifecycle script — documented inline",
  "PRINCIPAL1_SECRET": "e2e agents script — documented inline",
  "PRINCIPAL2_SECRET": "e2e agents script — documented inline",
  "APPRAISAL_SERVER_SECRET": "e2e agents script — documented inline",
  "CLIENT_SECRET": "e2e x402 script — documented inline",
  "SERVER_SECRET": "e2e x402 script — documented inline",
  "ISSUER_SECRET": "e2e agents script — documented inline",
  "WASM_HASH": "e2e scripts — documented inline",
  "HORIZON_URL": "e2e script — defaults to testnet horizon",
  "SUB_ROSA_WRITE_WEB_TRACE": "e2e script internal flag",
  "SUB_ROSA_WEB_DEMO_TRACE_OUT": "e2e script internal path",
  "ASSET_CODE": "usdc-setup e2e script — defaults to USDC",
  "MINT_AMOUNT": "usdc-setup e2e script — defaults to 1000",
  "VECTOR_ROUND": "drand-tools test vector generation script",
  "MAINNET_READER_PUBKEY": "optional override — hardcoded default exists",
  "MAX_WAIT_SECONDS": "keeper dry-run config — defaults to 0",
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && /\.(ts|tsx)$/i.test(entry)) yield full;
  }
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const result = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of ENV_PATTERNS) {
      const re = new RegExp(pattern);
      for (const m of lines[i].matchAll(re)) {
        const name = m[1];
        if (!name || name.startsWith("$")) continue;
        const key = `${name}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ varName: name, file: filePath, line: i + 1 });
      }
    }
  }
  return result;
}

function parseEnvExample(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const vars = [];
  const seen = new Set();
  for (const line of content.split("\n")) {
    const stripped = line.replace(/^#\s*/, "").trim();
    const m = stripped.match(/^([A-Z][A-Z_0-9]+)=/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      vars.push(m[1]);
    }
  }
  return vars;
}

function findEnvExamples() {
  const map = new Map();
  const root = join(ROOT, ".env.example");
  if (existsSync(root)) map.set(root, parseEnvExample(root));
  for (const dir of SRC_DIRS) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const pkg of readdirSync(full)) {
      const ep = join(full, pkg, ".env.example");
      if (existsSync(ep)) map.set(ep, parseEnvExample(ep));
    }
  }
  return map;
}

function main() {
  const envExamples = findEnvExamples();
  const documentedVars = new Set();
  const docSource = new Map();
  for (const [file, vars] of envExamples) {
    for (const v of vars) {
      documentedVars.add(v);
      docSource.set(v, [...(docSource.get(v) ?? []), relative(ROOT, file)]);
    }
  }

  const usages = [];
  for (const dir of SRC_DIRS) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      usages.push(...scanFile(file));
    }
  }

  const usedMap = new Map();
  for (const u of usages) {
    const arr = usedMap.get(u.varName) ?? [];
    arr.push(u);
    usedMap.set(u.varName, arr);
  }

  const usedVars = new Set(usedMap.keys());

  const missing = [];
  const allowed = [];
  const unused = [];

  for (const v of usedVars) {
    if (!documentedVars.has(v)) {
      if (v in ALLOWLIST) {
        allowed.push({ varName: v, usages: usedMap.get(v), reason: ALLOWLIST[v] });
      } else {
        missing.push(...usedMap.get(v));
      }
    }
  }

  for (const v of documentedVars) {
    if (!usedVars.has(v)) {
      unused.push(v);
    }
  }

  const red = (s) => `\u001b[31m${s}\u001b[0m`;
  const green = (s) => `\u001b[32m${s}\u001b[0m`;
  const yellow = (s) => `\u001b[33m${s}\u001b[0m`;
  const bold = (s) => `\u001b[1m${s}\u001b[0m`;

  console.log(bold("\n[Docs Drift Check] Env variable documentation audit"));
  console.log("\u2501".repeat(60));

  if (missing.length > 0) {
    const byVar = new Map();
    for (const m of missing) {
      const arr = byVar.get(m.varName) ?? [];
      arr.push(m);
      byVar.set(m.varName, arr);
    }
    console.log(`\n${red(bold(`MISSING \u2014 used in source but not in any .env.example (${byVar.size} vars):`))}`);
    for (const [name, occ] of byVar) {
      console.log(`  ${red(name)}`);
      for (const o of occ) {
        console.log(`    \u2192 ${relative(ROOT, o.file)}:${o.line}`);
      }
    }
  }

  if (allowed.length > 0) {
    console.log(`\n${yellow(bold(`ALLOWED \u2014 intentionally undocumented (${allowed.length} vars):`))}`);
    for (const a of allowed) {
      console.log(`  ${a.varName}  \u2014 ${a.reason}`);
    }
  }

  if (unused.length > 0) {
    console.log(`\n${yellow(bold(`UNUSED \u2014 documented in .env.example but never read in source (${unused.length} vars):`))}`);
    for (const v of unused) {
      const sources = docSource.get(v).join(", ");
      console.log(`  ${v}  (${sources})`);
    }
  }

  console.log(bold(`\nSummary:`));
  console.log(`  documented:  ${documentedVars.size}`);
  const missingVarCount = new Set(missing.map((m) => m.varName)).size;
  console.log(`  missing:     ${missingVarCount > 0 ? red(String(missingVarCount)) : green("0")}`);
  console.log(`  allowed:     ${allowed.length}`);
  console.log(`  unused:      ${unused.length}`);

  if (missing.length > 0) {
    console.log(`\n${red(bold(`\u2717 Drift found \u2014 ${missingVarCount} undocumented variable(s) in use.`))}`);
    console.log(`  Add missing vars to an .env.example or to ALLOWLIST in scripts/env-docs-check.mjs.\n`);
    process.exitCode = 1;
  } else {
    console.log(`\n${green(bold("\u2713 All env vars are documented or explicitly allowed.\n"))}`);
  }
}

main();
