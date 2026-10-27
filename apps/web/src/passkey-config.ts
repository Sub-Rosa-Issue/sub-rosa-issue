// Copyright (c) 2026 Sub Rosa contributors
import type { CommitParams, SubRosaClient } from "@sub-rosa/sdk";
import { assertNoUrlCredentials, validatePasskeySession } from "@sub-rosa/sdk";

/** Public testnet smart-wallet WASM (passkey-kit demo). Not a secret. */
export const PASSKEY_TESTNET_WALLET_WASM_HASH =
  "ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90";

const env: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env
    : typeof process !== "undefined" && process.env
      ? process.env
      : {};

export const PASSKEY_RPC_URL =
  env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";

export function resolvePasskeyRpcUrl(rawUrl: string = PASSKEY_RPC_URL): string {
  assertNoUrlCredentials(rawUrl, "VITE_RPC_URL");
  return rawUrl.trim();
}

export const PASSKEY_NETWORK_PASSPHRASE =
  env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export const PASSKEY_CONTRACT_ID =
  env.VITE_PASSKEY_CONTRACT_ID ?? env.VITE_CONTRACT_ID;

export function resolvePasskeyWalletWasmHash(): string | undefined {
  const fromEnv = env.VITE_PASSKEY_WALLET_WASM_HASH?.trim();
  if (fromEnv) return fromEnv;
  // Default for local jury demo — same hash as passkey-kit-demo on testnet.
  return PASSKEY_TESTNET_WALLET_WASM_HASH;
}

export interface PasskeySession {
  /** Contract ID the passkey session is bound to. */
  contractId: string;
  /** Network passphrase the passkey session is bound to. */
  networkPassphrase: string;
  /** Account/signer public address bound to this session. */
  account: string;
  keyId?: string;
  publicKey?: string;
  createdAt?: string;
}

/**
 * Record contract id, network passphrase, and account when a passkey session starts.
 */
export function createPasskeySession(params: {
  contractId?: string;
  networkPassphrase?: string;
  account: string;
  keyId?: string;
  publicKey?: string;
}): PasskeySession {
  const contractId = (params.contractId ?? PASSKEY_CONTRACT_ID)?.trim();
  if (!contractId) {
    throw new Error("contractId is required to start a passkey session");
  }
  const networkPassphrase = (
    params.networkPassphrase ?? PASSKEY_NETWORK_PASSPHRASE
  )?.trim();
  if (!networkPassphrase) {
    throw new Error("networkPassphrase is required to start a passkey session");
  }
  if (!params.account || params.account.trim() === "") {
    throw new Error("account is required to start a passkey session");
  }
  return {
    contractId,
    networkPassphrase,
    account: params.account.trim(),
    keyId: params.keyId,
    publicKey: params.publicKey,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Execute a commit bound to a passkey session.
 * Refuses commit with a typed error if contract id, network passphrase, or account differ from the current SDK client.
 */
export async function commitWithPasskeySession(
  session: PasskeySession,
  client: SubRosaClient,
  commitParams: Omit<CommitParams, "session">,
): Promise<void> {
  validatePasskeySession(session, {
    contractId: client.contractId,
    networkPassphrase: client.networkPassphrase,
    account: commitParams.bidder ?? client.account,
  });
  return client.commit({
    ...commitParams,
    session,
  });
}

