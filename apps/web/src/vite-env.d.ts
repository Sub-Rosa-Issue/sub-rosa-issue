// Copyright (c) 2026 Sub Rosa contributors
/// <reference types="vite/client" />

declare module "process/browser";

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_NETWORK_PASSPHRASE?: string;
  readonly VITE_CONTRACT_ID?: string;
  readonly VITE_ROUND_ID?: string;
  readonly VITE_ESCROW_TOKEN_LABEL?: string;
  readonly VITE_PASSKEY_WALLET_WASM_HASH?: string;
  readonly VITE_PASSKEY_RP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
