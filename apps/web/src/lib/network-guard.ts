// Copyright (c) 2026 Sub Rosa contributors
// Demo network guard — refuses a commit/reveal/settle when the wallet's
// detected chain passphrase no longer matches the network the SDK client was
// configured for. Kept free of wallet/tlock imports so it can be unit-tested
// and reused anywhere an on-chain action is about to be built.
import {
  describeNetworkPassphraseMismatch,
  networkDisplayName,
  networkPassphrasesMatch,
} from "@sub-rosa/sdk/network";

/** Demo actions that submit a transaction; each must match the SDK network. */
export type DemoActionName = "commit" | "reveal" | "settle";

export interface DemoNetworkCheck {
  action: DemoActionName;
  /** Passphrase detected from the connected chain / wallet. */
  chainPassphrase: string;
  /** Passphrase the SDK client (RoundContract) is configured for. */
  sdkPassphrase: string;
}

/**
 * Raised when a demo action is refused because the connected chain and the
 * SDK client point at different networks. Carries both network labels so they
 * can be surfaced to the operator. Never holds a secret or a signed XDR.
 */
export class DemoNetworkMismatchError extends Error {
  readonly name = "DemoNetworkMismatchError";
  readonly action: DemoActionName;
  readonly chainPassphrase: string;
  readonly sdkPassphrase: string;
  readonly chainNetwork: string;
  readonly sdkNetwork: string;

  constructor(params: DemoNetworkCheck) {
    super(
      `Cannot ${params.action}: ${describeNetworkPassphraseMismatch(
        params.chainPassphrase,
        params.sdkPassphrase,
      )}. Switch the wallet to the SDK client's network and reconnect.`,
    );
    this.action = params.action;
    this.chainPassphrase = params.chainPassphrase;
    this.sdkPassphrase = params.sdkPassphrase;
    this.chainNetwork = networkDisplayName(params.chainPassphrase);
    this.sdkNetwork = networkDisplayName(params.sdkPassphrase);
  }
}

/**
 * Non-throwing detector: returns both network labels when the chain helper's
 * passphrase differs from the SDK client's, or `null` when they agree (or
 * either is unknown). Used to disable demo CTAs before the action runs.
 */
export function demoNetworkMismatch(params: {
  chainPassphrase: string;
  sdkPassphrase: string;
}): { chainNetwork: string; sdkNetwork: string } | null {
  const chainPassphrase = params.chainPassphrase.trim();
  const sdkPassphrase = params.sdkPassphrase.trim();
  if (chainPassphrase === "" || sdkPassphrase === "") return null;
  if (networkPassphrasesMatch(chainPassphrase, sdkPassphrase)) return null;
  return {
    chainNetwork: networkDisplayName(chainPassphrase),
    sdkNetwork: networkDisplayName(sdkPassphrase),
  };
}

/**
 * Refuse a demo commit, reveal, or settle when the chain helper's detected
 * passphrase differs from the SDK client's configured network. When either
 * passphrase is unknown the action is allowed (nothing to compare). The error
 * names both networks and contains no secret or signed transaction.
 */
export function assertDemoNetworkMatch(params: DemoNetworkCheck): void {
  const chainPassphrase = params.chainPassphrase.trim();
  const sdkPassphrase = params.sdkPassphrase.trim();
  if (demoNetworkMismatch({ chainPassphrase, sdkPassphrase }) === null) return;
  throw new DemoNetworkMismatchError({ ...params, chainPassphrase, sdkPassphrase });
}
