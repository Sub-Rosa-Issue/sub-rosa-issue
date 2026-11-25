// Copyright (c) 2026 Sub Rosa contributors

const CONNECT_ORIGIN_KEYS = [
  "VITE_RPC_URL",
  "VITE_KEEPER_URL",
  "VITE_APPRAISAL_URL",
  "VITE_DRAND_URL",
  "VITE_DASHBOARD_ENDPOINT",
] as const;

const DEFAULT_CONNECT_ORIGINS = {
  VITE_RPC_URL: "https://soroban-testnet.stellar.org",
  VITE_DRAND_URL: "https://api.drand.sh",
} as const;

export function productionConnectSrc(
  env: Record<string, string | undefined>,
): string {
  const origins = new Set<string>();

  for (const key of CONNECT_ORIGIN_KEYS) {
    const configured = env[key]?.trim();
    const value = configured || DEFAULT_CONNECT_ORIGINS[key as keyof typeof DEFAULT_CONNECT_ORIGINS];
    if (!value) continue;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${key} must be a valid absolute HTTP(S) URL for production CSP.`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${key} must use http:// or https:// for production CSP.`);
    }
    if (url.username || url.password) {
      throw new Error(`${key} must not contain credentials for production CSP.`);
    }
    if (url.hostname.includes("*")) {
      throw new Error(`${key} must not use a wildcard origin in production CSP.`);
    }

    origins.add(url.origin);
  }

  return ["'self'", ...origins].join(" ");
}
