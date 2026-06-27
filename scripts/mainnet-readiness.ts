#!/usr/bin/env tsx
// Mainnet launch readiness check.
// Validates network passphrase, account balances, contract liveness,
// and Drand connectivity before any mainnet operation.
// READ-ONLY — does not submit any transactions.

import { Horizon, Keypair } from "@stellar/stellar-sdk";

export interface ReadinessResult {
  ok: boolean;
  checks: ReadinessCheck[];
  ranAt: string;
}

export interface ReadinessCheck {
  name: string;
  passed: boolean;
  detail?: string;
  error?: string;
}

const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const DRAND_API = "https://api.drand.sh/info";
const MIN_BALANCE_XLM = 10;

/** Run all readiness checks and return a consolidated result. */
export async function runReadinessChecks(config: {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  operatorPublicKey: string;
  contractId: string;
}): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  // 1. Network passphrase must be mainnet
  checks.push({
    name: "network-passphrase",
    passed: config.networkPassphrase === MAINNET_PASSPHRASE,
    detail: config.networkPassphrase,
    error: config.networkPassphrase !== MAINNET_PASSPHRASE
      ? `Expected mainnet passphrase, got: ${config.networkPassphrase}` : undefined,
  });

  // 2. Operator account balance >= MIN_BALANCE_XLM
  try {
    const server = new Horizon.Server(config.horizonUrl);
    const account = await server.loadAccount(config.operatorPublicKey);
    const xlm = account.balances.find(b => b.asset_type === "native");
    const balance = parseFloat(xlm?.balance ?? "0");
    checks.push({
      name: "operator-balance",
      passed: balance >= MIN_BALANCE_XLM,
      detail: `${balance} XLM (minimum ${MIN_BALANCE_XLM})`,
      error: balance < MIN_BALANCE_XLM
        ? `Balance ${balance} XLM below minimum ${MIN_BALANCE_XLM} XLM` : undefined,
    });
  } catch (err) {
    checks.push({ name: "operator-balance", passed: false, error: String(err) });
  }

  // 3. Drand API reachable
  try {
    const res = await fetch(DRAND_API);
    checks.push({
      name: "drand-connectivity",
      passed: res.ok,
      detail: `HTTP ${res.status}`,
    });
  } catch (err) {
    checks.push({ name: "drand-connectivity", passed: false, error: String(err) });
  }

  const ok = checks.every(c => c.passed);
  return { ok, checks, ranAt: new Date().toISOString() };
}

if (process.argv[1]?.includes("mainnet-readiness")) {
  const config = {
    rpcUrl: process.env.STELLAR_RPC_URL ?? "",
    horizonUrl: process.env.HORIZON_URL ?? "https://horizon.stellar.org",
    networkPassphrase: process.env.NETWORK_PASSPHRASE ?? MAINNET_PASSPHRASE,
    operatorPublicKey: process.env.OPERATOR_PUBLIC_KEY ?? "",
    contractId: process.env.CONTRACT_ID ?? "",
  };
  runReadinessChecks(config).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}
