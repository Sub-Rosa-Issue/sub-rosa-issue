import { normalizeError, publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { Buffer } from "buffer";
import {
  getAddress,
  getNetworkDetails,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { RoundContract } from "@sub-rosa/sdk";
import { useMemo } from "react";

import { formatEscrowAmount } from "./amount";
import { configuredNetworkPassphrase, publicEnv } from "./config";

const env = publicEnv();

export const LOGO_SRC = "/sub-rosa-logo.png";
export const RPC_URL = env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK = configuredNetworkPassphrase(env);
export const CONTRACT_ID = env.VITE_CONTRACT_ID;
export const ESCROW_TOKEN_LABEL = env.VITE_ESCROW_TOKEN_LABEL ?? "token";
export const DEFAULT_ROUND_ID = env.VITE_ROUND_ID ? BigInt(env.VITE_ROUND_ID) : null;

/** Seconds between commit deadline and Drand round R (the “Wait for Drand R” UI phase). */
export const LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS = 10;
/** Default commit window when createRound is called without a preset. */
export const LIVE_COMMIT_WINDOW_SECONDS = 27;
/** Default seconds from round creation until Drand R (~commit window + wait above). */
export const LIVE_REVEAL_IN_SECONDS =
  LIVE_COMMIT_WINDOW_SECONDS + LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
export const LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS = 240;

/**
 * Operator-selectable commit window presets (seconds).
 * The reveal happens approximately commitWindow + LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS
 * later, so a 120s window means ~130s until Drand R publishes.
 */
export const COMMIT_DURATION_PRESETS: Array<{ seconds: number; label: string; helper: string }> = [
  { seconds: 27, label: "27s", helper: "solo demo" },
  { seconds: 60, label: "1 min", helper: "quick paired" },
  { seconds: 120, label: "2 min", helper: "paired demo" },
  { seconds: 300, label: "5 min", helper: "public test" },
];

export const DEFAULT_COMMIT_DURATION_SECONDS = 27;

export function freighterError(result: { error?: unknown }) {
  if (!result.error) return null;
  return publicErrorMessage(result.error);
}

export function displayError(error: unknown): string {
  const normalized = normalizeError(error);
  // Network-mismatch errors are safe and actionable: surface both network
  // labels verbatim instead of the generic public message.
  if (normalized.name === "DemoNetworkMismatchError") return normalized.message;
  const message = normalized.message;
  if (message.includes("Contract, #10")) {
    return "Commit window closed. Create a fresh round, then commit before Drand reaches reveal.";
  }
  if (message.includes("Contract, #15")) {
    return "Reveal window closed for this round. Create a new round and open + reveal soon after Drand R (within ~4 minutes).";
  }
  if (message.includes("got 425") || message.includes("Error response fetching")) {
    return "Drand R is not published yet. Wait for the countdown, then open + reveal.";
  }
  if (message.includes("trustline entry is missing")) {
    return "Wallet is missing the escrow asset trustline. Fund the testnet wallet or use the XLM demo contract.";
  }
  return publicErrorMessage(error);
}

export function toDemoEscrowAmount(value: number): bigint {
  return BigInt(Math.max(1, Math.round(value * 100_000)));
}

export function formatDemoAmount(value: bigint): string {
  return formatEscrowAmount(value, ESCROW_TOKEN_LABEL);
}

export async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function stellarExpertTxLink(hash: string): string {
  const network = NETWORK.includes("Public") ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

export function useWalletContract(address: string | null) {
  return useMemo(() => {
    if (!address || !CONTRACT_ID) return null;
    return new RoundContract({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK,
      rpcUrl: RPC_URL,
      publicKey: address,
      signTransaction: async (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        return {
          signedTxXdr: signed.signedTxXdr,
          signerAddress: signed.signerAddress,
        };
      },
      signAuthEntry: async (entryXdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signAuthEntry(entryXdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        if (!signed.signedAuthEntry) throw new Error("Freighter returned no signed auth entry");
        return {
          signedAuthEntry: signed.signedAuthEntry,
          signerAddress: signed.signerAddress,
        };
      },
    });
  }, [address]);
}

/**
 * Passphrase the SDK client (or `null` before the wallet connects) is bound
 * to. Contract StrKeys do not encode a network, so this is the app's SDK-side
 * source of truth for the demo's target network.
 */
export function sdkClientNetworkPassphrase(
  client: RoundContract | null | undefined,
): string {
  return client?.options?.networkPassphrase ?? "";
}

/**
 * Read the passphrase the connected wallet/chain currently reports. A wallet
 * switch can change this independently of the SDK client, so it must be read
 * immediately before each state-changing action.
 */
export async function detectChainNetworkPassphrase(): Promise<string> {
  const details = await getNetworkDetails();
  const error = freighterError(details);
  if (error) throw new Error(error);
  return details.networkPassphrase;
}

export async function resolveFreighterAddress(
  access: { address?: string; publicKey?: string },
): Promise<string> {
  const addr = access.address ?? access.publicKey;
  if (addr) return addr;
  const current = await getAddress();
  const currentError = freighterError(current);
  if (currentError) throw new Error(currentError);
  return current.address;
}
