// Copyright (c) 2026 Sub Rosa contributors
export interface ConfigIssue {
  key: string;
  message: string;
}

/** Fallback passphrase for local/testnet demos when no env override is set. */
export const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Safe accessor for the Vite public env. Returns an empty object outside Vite
 * (for example under `node --test`), so modules that read config at import
 * time stay importable.
 */
export function publicEnv(): Record<string, string | undefined> {
  return import.meta.env ?? {};
}

/**
 * The passphrase the app (and the SDK client it builds) is configured for.
 * Single source of truth so the chain helper and config validation cannot
 * drift from each other.
 */
export function configuredNetworkPassphrase(
  env: Record<string, string | undefined> = publicEnv(),
): string {
  return env.VITE_NETWORK_PASSPHRASE?.trim() || DEFAULT_NETWORK_PASSPHRASE;
}

const CRITICAL_KEYS = [
  "VITE_RPC_URL",
  "VITE_NETWORK_PASSPHRASE",
  "VITE_CONTRACT_ID",
] as const;

const OPTIONAL_KEYS = [
  "VITE_ESCROW_TOKEN_LABEL",
  "VITE_ROUND_ID",
] as const;

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

const PLACEHOLDER_VALUES: Record<string, string[]> = {
  VITE_RPC_URL: ["https://soroban-testnet.stellar.org"],
  VITE_NETWORK_PASSPHRASE: [DEFAULT_NETWORK_PASSPHRASE],
  VITE_CONTRACT_ID: [
    "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
    "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y",
  ],
};

export function validatePublicConfig(
  env: Record<string, string | undefined> = import.meta.env,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (const key of CRITICAL_KEYS) {
    const value = env[key];
    if (!value || value.trim() === "") {
      issues.push({
        key,
        message: `${key} is missing — the demo will not function correctly. Set it in .env.local or deployment environment variables.`,
      });
    }
  }

  for (const key of OPTIONAL_KEYS) {
    const value = env[key];
    if (!value || value.trim() === "") {
      issues.push({
        key,
        message: `${key} is missing (optional — some features may degrade).`,
      });
    }
  }

  for (const key of CRITICAL_KEYS) {
    const value = env[key];
    if (value && value.trim() !== "") {
      const trimmed = key === "VITE_RPC_URL" ? normalizeUrl(value) : value.trim();
      const placeholders = PLACEHOLDER_VALUES[key];
      if (placeholders?.includes(trimmed)) {
        issues.push({
          key,
          message: `${key} appears to be a default/example value (${value}). Update it to your own contract and network config.`,
        });
      }
    }
  }

  const rpcUrl = env.VITE_RPC_URL;
  if (rpcUrl && rpcUrl.trim() !== "") {
    const normalized = normalizeUrl(rpcUrl);
    if (!/^https?:\/\//.test(normalized)) {
      issues.push({
        key: "VITE_RPC_URL",
        message: `VITE_RPC_URL is not a valid URL (${rpcUrl}). It must start with http:// or https://.`,
      });
    } else {
      try {
        const parsed = new URL(normalized);
        if (parsed.username !== "" || parsed.password !== "") {
          issues.push({
            key: "VITE_RPC_URL",
            message:
              "VITE_RPC_URL must not contain credentials (username or password).",
          });
        }
      } catch {
        if (/^https?:\/\/[^/\s?#]*@/i.test(normalized)) {
          issues.push({
            key: "VITE_RPC_URL",
            message:
              "VITE_RPC_URL must not contain credentials (username or password).",
          });
        }
      }
    }
  }

  const passkeyContractId = env.VITE_PASSKEY_CONTRACT_ID;
  const contractId = env.VITE_CONTRACT_ID;
  if (
    passkeyContractId &&
    contractId &&
    passkeyContractId.trim() !== "" &&
    contractId.trim() !== "" &&
    passkeyContractId.trim() !== contractId.trim()
  ) {
    issues.push({
      key: "VITE_PASSKEY_CONTRACT_ID",
      message: `VITE_PASSKEY_CONTRACT_ID (${passkeyContractId}) does not match VITE_CONTRACT_ID (${contractId}). Passkey session will be bound to a different contract than web config.`,
    });
  }

  const passkeyPassphrase = env.VITE_PASSKEY_NETWORK_PASSPHRASE;
  const networkPassphrase = env.VITE_NETWORK_PASSPHRASE;
  if (
    passkeyPassphrase &&
    networkPassphrase &&
    passkeyPassphrase.trim() !== "" &&
    networkPassphrase.trim() !== "" &&
    passkeyPassphrase.trim() !== networkPassphrase.trim()
  ) {
    issues.push({
      key: "VITE_PASSKEY_NETWORK_PASSPHRASE",
      message: `VITE_PASSKEY_NETWORK_PASSPHRASE does not match VITE_NETWORK_PASSPHRASE. Passkey session cannot commit across different networks.`,
    });
  }

  return issues;
}

export function hasConfigIssues(
  env: Record<string, string | undefined> = import.meta.env,
): boolean {
  return validatePublicConfig(env).length > 0;
}

// ── Demo action gate ──────────────────────────────────────────────────────
// The banner and the demo actions must agree: when the public config and the
// SDK client disagree on contract id or network passphrase, commit, reveal and
// settle are disabled. Messages name keys only, never env values.

export type DemoAction = "commit" | "reveal" | "settle";
export const DEMO_ACTIONS: readonly DemoAction[] = ["commit", "reveal", "settle"];

/** The identity the SDK client was constructed with (e.g. `RoundContract.options`). */
export interface SdkClientIdentity {
  contractId?: string | null;
  networkPassphrase?: string | null;
}

export interface DemoActionGate {
  enabled: boolean;
  issues: ConfigIssue[];
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function gateDemoActions(
  client: SdkClientIdentity | null,
  env: Record<string, string | undefined> = import.meta.env ?? {},
): DemoActionGate {
  const issues: ConfigIssue[] = [];
  const publicContract = present(env.VITE_CONTRACT_ID);
  const publicNetwork = present(env.VITE_NETWORK_PASSPHRASE);

  if (!publicContract) {
    issues.push({ key: "VITE_CONTRACT_ID", message: "VITE_CONTRACT_ID is missing — demo commit, reveal and settle are disabled." });
  }
  if (!publicNetwork) {
    issues.push({ key: "VITE_NETWORK_PASSPHRASE", message: "VITE_NETWORK_PASSPHRASE is missing — demo commit, reveal and settle are disabled." });
  }
  if (!client) {
    issues.push({ key: "sdk-client", message: "The SDK client is not configured — demo commit, reveal and settle are disabled." });
  } else {
    if (publicContract && present(client.contractId) !== publicContract) {
      issues.push({ key: "VITE_CONTRACT_ID", message: "VITE_CONTRACT_ID does not match the SDK client contract id — demo commit, reveal and settle are disabled." });
    }
    if (publicNetwork && present(client.networkPassphrase) !== publicNetwork) {
      issues.push({ key: "VITE_NETWORK_PASSPHRASE", message: "VITE_NETWORK_PASSPHRASE does not match the SDK client network — demo commit, reveal and settle are disabled." });
    }
  }
  return { enabled: issues.length === 0, issues };
}
