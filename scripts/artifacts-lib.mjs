import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

export const PATHS = {
  wasm: join(ROOT, "artifacts/sub_rosa_round.wasm"),
  bindings: join(ROOT, "packages/round-bindings/src/index.ts"),
  manifest: join(ROOT, "deployments/artifact-manifest.json"),
  contractSrc: join(ROOT, "contracts/round/src"),
  tmpBindings: join(ROOT, "tmp-bindings"),
};

export const SOURCE_COMMAND = "pnpm bindings:generate";

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(path) {
  return sha256Hex(readFileSync(path));
}

export function extractSpecEntries(content) {
  const marker = "new ContractSpec([";
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new Error("ContractSpec([...]) not found in bindings");
  }

  let i = start + marker.length;
  const entries = [];

  while (i < content.length) {
    while (i < content.length && /[\s,]/.test(content[i])) {
      i += 1;
    }
    if (content[i] === "]") {
      break;
    }
    if (content[i] !== '"') {
      throw new Error(`Expected spec string at index ${i}`);
    }
    i += 1;

    let entry = "";
    while (i < content.length) {
      const ch = content[i];
      i += 1;
      if (ch === "\\") {
        entry += content[i];
        i += 1;
        continue;
      }
      if (ch === '"') {
        break;
      }
      entry += ch;
    }
    entries.push(entry);
  }

  if (entries.length === 0) {
    throw new Error("No ContractSpec entries found in bindings");
  }

  return entries;
}

export function computeSpecHash(bindingsContent) {
  const entries = extractSpecEntries(bindingsContent);
  return sha256Hex(entries.join("\n"));
}

export function computeSourceHash() {
  const files = readdirSync(PATHS.contractSrc)
    .filter((name) => name.endsWith(".rs"))
    .sort();

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(join(PATHS.contractSrc, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readManifest() {
  return JSON.parse(readFileSync(PATHS.manifest, "utf8"));
}

export function writeManifest(manifest) {
  mkdirSync(dirname(PATHS.manifest), { recursive: true });
  writeFileSync(PATHS.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function run(cmd, options = {}) {
  execSync(cmd, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
}

export function capture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function stellarCliVersion() {
  try {
    return capture("stellar --version").split("\n")[0];
  } catch {
    return "unknown";
  }
}

export function buildWasm() {
  run("stellar contract build --out-dir artifacts");
}

export function generateBindingsToTemp() {
  rmSync(PATHS.tmpBindings, { recursive: true, force: true });
  run(
    `stellar contract bindings typescript --wasm artifacts/sub_rosa_round.wasm --output-dir tmp-bindings --overwrite`,
  );
}

export function installBindingsFromTemp() {
  copyFileSync(
    join(PATHS.tmpBindings, "src/index.ts"),
    PATHS.bindings,
  );
  rmSync(PATHS.tmpBindings, { recursive: true, force: true });
}

export function networkProfiles() {
  return {
    local: {
      networkPassphrase: "Standalone Network ; February 2017",
      rpcUrl: "http://localhost:8000/soroban/rpc",
      contractId: null,
      note: "Ephemeral contracts per e2e run; no pinned deployment.",
    },
    testnet: {
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      deployments: {
        agentsE2eProof: {
          contractId:
            "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y",
          revealRound: 29_176_840,
          note: "Canonical jury demo trace from pnpm agents:e2e.",
        },
      },
    },
    mainnet: {
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      rpcUrl: "https://rpc.ankr.com/stellar_soroban",
      deployments: {
        smokeRound1: {
          contractId:
            "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
          wasmHash:
            "353915ad440965ea5f8d92fdb8d93cb2e309fb365e68e6762bca7fd6762b30c7",
          revealRound: 29_174_905,
          note: "Frozen mainnet smoke round; see packages/sdk/src/mainnet-artifacts.ts.",
        },
      },
    },
  };
}

export function buildManifest({ wasmHash, specHash, sourceHash }) {
  return {
    schemaVersion: 1,
    contract: {
      crate: "sub-rosa-round",
      packageVersion: "0.1.0",
      sourcePath: "contracts/round/src",
      sourceHash,
    },
    build: {
      wasmFile: "artifacts/sub_rosa_round.wasm",
      wasmHash,
      bindingsPath: "packages/round-bindings/src/index.ts",
      specHash,
      generatedAt: new Date().toISOString(),
      sourceCommand: SOURCE_COMMAND,
      toolchain: {
        stellarCli: stellarCliVersion(),
      },
    },
    networks: networkProfiles(),
  };
}
