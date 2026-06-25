# Stellar Wallets Kit Integration

This document outlines the usage of `@creit.tech/stellar-wallets-kit` in the Sub Rosa application.

## Overview

We use the official `StellarWalletsKit` class from the `@creit.tech/stellar-wallets-kit` package to provide a wallet-agnostic adapter. The wrapper resides in `apps/web/src/lib/wallet.ts` and is exposed via the `WalletAdapter` interface.

## Supported Capabilities

The Sub Rosa UI relies heavily on Soroban smart contracts. Therefore, a connected wallet must support:
- `signTransaction`: To submit commits and reveals.
- `signAuthEntry`: To authorize contract invocations.

If a wallet does not support these capabilities (e.g., Albedo or xBull lacking `signAuthEntry` in older SDK iterations), the UI will explicitly block the user from interacting with the contract and prompt them with an "Unsupported Wallet" alert.

## Network Enforcement

Sub Rosa is currently configured to run on the **Testnet**. 

If a user connects their wallet but their network is set to Mainnet or Futurenet, the UI will complete the connection but will block all actions. A "Wrong Network" indicator will be displayed, instructing the user to switch their wallet to Testnet before proceeding.

## Known Limitations
- The `getNetwork` method is not supported reliably by all wallet modules in `@creit.tech/stellar-wallets-kit`. We provide fallback logic assuming the target network, but wallets that strictly misreport their network may bypass the initial check until a transaction fails.
- `disconnect` behavior varies by wallet module; some wallets simply clear local state without disconnecting the session in the extension.
