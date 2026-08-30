// Copyright (c) 2026 Sub Rosa contributors
// x402 paid-fetch client.
//
// Wraps a single HTTP call with the x402 handshake: try the request, and if the
// server answers 402, sign the Soroban auth entry authorizing the USDC transfer
// and retry with the `X-PAYMENT` header. Returns both the resource body and the
// on-chain settlement receipt. This is what an autonomous bidder agent uses to
// pay the appraisal API per call.

import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, SettleResponse } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ClientStellarScheme } from "@x402/stellar/exact/client";

export interface PaidClientConfig {
  /** Payer secret key (S...). Needs a USDC trustline + balance. */
  secret: string;
  /** CAIP-2 network id (default stellar:testnet). */
  network?: Network;
  /** Optional custom Soroban RPC URL. */
  rpcUrl?: string;
}

export interface PaidResult<T = unknown> {
  status: number;
  body: T;
  /** Present when a payment was made and settled on-chain. */
  settlement?: SettleResponse;
}

export class X402PaymentError extends Error {}

/** Build a paid-fetch function bound to a payer wallet. */
export function createPaidFetch(config: PaidClientConfig) {
  const network = config.network ?? "stellar:testnet";
  const signer = createEd25519Signer(config.secret, network);
  const rpcConfig = config.rpcUrl ? { url: config.rpcUrl } : undefined;
  const core = new x402Client().register(
    "stellar:*",
    new ClientStellarScheme(signer, rpcConfig),
  );
  const http = new x402HTTPClient(core);

  return async function paidFetch<T = unknown>(
    url: string,
    init: RequestInit = {},
  ): Promise<PaidResult<T>> {
    const first = await fetch(url, init);
    if (first.status !== 402) {
      return { status: first.status, body: (await first.json()) as T };
    }

    // 402 → build the signed payment and retry.
    const bodyForParse = await first.clone().json().catch(() => undefined);
    const paymentRequired = http.getPaymentRequiredResponse(
      (name) => first.headers.get(name),
      bodyForParse,
    );
    const payload = await http.createPaymentPayload(paymentRequired);
    const payHeaders = http.encodePaymentSignatureHeader(payload);

    const paid = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...payHeaders },
    });
    const body = (await paid.json()) as T;

    if (paid.status !== 200) {
      throw new X402PaymentError(
        `paid request failed (${paid.status}): ${JSON.stringify(body)}`,
      );
    }
    const settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
    return { status: paid.status, body, settlement };
  };
}
