import { publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { useMemo, useState } from "react";
import { SubRosaClient, validatePasskeySession } from "@sub-rosa/sdk";
import { CAP_SAFETY_COPY } from "../demo/trace";
import { useTime } from "../lib/time";
import {
  PASSKEY_CONTRACT_ID,
  PASSKEY_NETWORK_PASSPHRASE,
  PASSKEY_RPC_URL,
  createPasskeySession,
  resolvePasskeyWalletWasmHash,
  type PasskeySession,
} from "../passkey-config";

type PasskeyStatus = "idle" | "loading" | "ready" | "blocked" | "error";

const LINKS = [
  {
    label: "Passkey-Kit (legacy demo)",
    href: "https://passkey-kit-demo.pages.dev/",
    note: "WebAuthn smart wallet precursor; session keys map to our mandate pattern.",
  },
  {
    label: "Smart Account Kit",
    href: "https://github.com/kalepail/smart-account-kit",
    note: "Production path: OZ Smart Accounts, context rules, spending limits, relayer.",
  },
  {
    label: "OZ Relayer — Stellar channels",
    href: "https://docs.openzeppelin.com/relayer/1.3.x/guides/stellar-channels-guide",
    note: "Optional fee sponsor for passkey-signed txs; Sub Rosa uses direct Soroban RPC today.",
  },
  {
    label: "Scaffold Stellar",
    href: "https://github.com/thebadass-dev/scaffold-stellar",
    note: "App scaffold for Stellar dApps; swap in smart-account-kit for passkey principals.",
  },
];

export interface PasskeyPanelProps {
  client?: SubRosaClient;
  onCommit?: (session: PasskeySession) => Promise<void>;
  initialSession?: PasskeySession | null;
}

export function PasskeyPanel({
  client: injectedClient,
  onCommit,
  initialSession = null,
}: PasskeyPanelProps = {}) {
  const { clock } = useTime();
  const [status, setStatus] = useState<PasskeyStatus>("idle");
  const [message, setMessage] = useState<string>(
    "Create a browser passkey (Touch ID / Face ID / security key). Does not change Round agents.",
  );
  const [wallet, setWallet] = useState<{
    keyId?: string;
    publicKey?: string;
    contractId?: string;
  } | null>(null);
  const [session, setSession] = useState<PasskeySession | null>(initialSession);
  const [panelError, setPanelError] = useState<Error | null>(null);

  const walletWasmHash = resolvePasskeyWalletWasmHash();
  const rpId = import.meta.env.VITE_PASSKEY_RP_ID ?? window.location.hostname;
  const passkeyAvailable = useMemo(
    () =>
      typeof window !== "undefined" &&
      "PublicKeyCredential" in window &&
      typeof navigator.credentials?.create === "function",
    [],
  );

  function passkeyKitOptions() {
    if (!walletWasmHash) throw new Error("wallet WASM hash not configured");
    return {
      rpcUrl: PASSKEY_RPC_URL,
      networkPassphrase: PASSKEY_NETWORK_PASSPHRASE,
      walletWasmHash,
    };
  }

  function passkeyUserId(): string {
    // passkey-kit builds WebAuthn user.id from `${user}:${time}:${random}` — must decode to ≤64 bytes.
    return `sr-${clock.nowMs().toString(36)}`;
  }

  async function createDemoKey() {
    if (!passkeyAvailable) {
      setStatus("blocked");
      setMessage("WebAuthn not available in this browser.");
      return;
    }
    setStatus("loading");
    setMessage("Opening browser passkey prompt…");
    setPanelError(null);
    try {
      const { PasskeyKit } = await import("passkey-kit");
      const account = new PasskeyKit(passkeyKitOptions());
      const created = await account.createKey("Sub Rosa", passkeyUserId(), {
        rpId,
      });
      const keyId = created.keyIdBase64 ?? created.keyId;
      const publicKey =
        typeof created.publicKey === "string"
          ? created.publicKey
          : Array.from(created.publicKey ?? [])
              .map((b: number) => b.toString(16).padStart(2, "0"))
              .join("");
      setWallet({
        keyId,
        publicKey,
      });

      // Record contract id, network passphrase, and account when the passkey session starts
      if (PASSKEY_CONTRACT_ID) {
        const newSession = createPasskeySession({
          contractId: PASSKEY_CONTRACT_ID,
          networkPassphrase: PASSKEY_NETWORK_PASSPHRASE,
          account: publicKey,
          keyId,
          publicKey,
        });
        setSession(newSession);
      }

      setStatus("ready");
      setMessage(
        "Passkey registered in this browser. Principal secret never left the secure enclave.",
      );
    } catch (e) {
      setStatus("error");
      const err = e instanceof Error ? e : new Error(String(e));
      setPanelError(err);
      setMessage(publicErrorMessage(e));
    }
  }

  async function deploySmartWallet() {
    if (!passkeyAvailable) {
      setStatus("blocked");
      setMessage("WebAuthn not available in this browser.");
      return;
    }
    setStatus("loading");
    setMessage("Deploying Soroban smart wallet on testnet (passkey + deploy tx)…");
    setPanelError(null);
    try {
      const { PasskeyKit } = await import("passkey-kit");
      const account = new PasskeyKit(passkeyKitOptions());
      const created = await account.createWallet("Sub Rosa", passkeyUserId(), {
        rpId,
      });
      const keyId = created.keyIdBase64 ?? created.keyId;
      setWallet({
        keyId,
        contractId: created.contractId,
      });

      // Record contract id, network passphrase, and account when smart wallet session starts
      if (PASSKEY_CONTRACT_ID) {
        const newSession = createPasskeySession({
          contractId: PASSKEY_CONTRACT_ID,
          networkPassphrase: PASSKEY_NETWORK_PASSPHRASE,
          account: created.contractId,
          keyId,
        });
        setSession(newSession);
      }

      setStatus("ready");
      setMessage(`Smart wallet deployed on testnet: ${created.contractId}`);
    } catch (e) {
      setStatus("error");
      const err = e instanceof Error ? e : new Error(String(e));
      setPanelError(err);
      const detail = publicErrorMessage(e);
      setMessage(
        `Deploy failed: ${detail}. Try again after refresh; if it persists, sponsor funding on testnet may be missing (Create passkey alone is enough for the demo).`,
      );
    }
  }

  async function commitWithPasskey(clientOverride?: SubRosaClient) {
    if (!session) {
      setStatus("error");
      const err = new Error("No passkey session available. Create a passkey first.");
      setPanelError(err);
      setMessage(err.message);
      return;
    }

    setStatus("loading");
    setMessage("Validating passkey session binding…");
    setPanelError(null);

    const client =
      clientOverride ??
      injectedClient ??
      new SubRosaClient({
        rpcUrl: PASSKEY_RPC_URL,
        networkPassphrase: PASSKEY_NETWORK_PASSPHRASE,
        contractId: PASSKEY_CONTRACT_ID ?? "",
        publicKey: session.account,
      });

    try {
      // Refuse a commit when contract id, network passphrase, or account differ from SDK client
      validatePasskeySession(session, {
        contractId: client.contractId,
        networkPassphrase: client.networkPassphrase,
        account: client.account,
      });

      if (onCommit) {
        await onCommit(session);
      } else {
        await client.commit({
          roundId: 1,
          sealed: {
            commitment: new Uint8Array(32),
            ciphertext: new Uint8Array([0x61, 0x67, 0x65]),
            auditorBlob: new Uint8Array(1),
          },
          escrow: 100_000n,
          bidder: session.account,
          session,
        });
      }

      setStatus("ready");
      setMessage("Passkey commit submitted successfully.");
    } catch (e: unknown) {
      setStatus("error");
      const err = e instanceof Error ? e : new Error(String(e));
      setPanelError(err);
      // Ensure fixture secret seed is kept strictly out of the error message
      const scrubbed = err.message.replace(/\bS[A-Z2-7]{55}\b/g, "[REDACTED]");
      setMessage(scrubbed);
    }
  }

  return (
    <section className="panel passkey-panel">
      <header className="panel-head">
        <h2>Passkey wallet policy (ecosystem path)</h2>
        <p>
          This demo uses Ed25519 session keys with a principal-signed mandate. Production agents
          should issue the same caps from a passkey-controlled smart account.
        </p>
      </header>

      <div className="passkey-map">
        <article className="card">
          <h3>Today (proven in agents:e2e)</h3>
          <ul className="keeper-list">
            <li>
              <strong>Principal</strong>
              <span>G-address signs mandate off-chain</span>
            </li>
            <li>
              <strong>Session key</strong>
              <span>Commits + x402 USDC; never exposes principal secret</span>
            </li>
            <li>
              <strong>Caps</strong>
              <span>maxBid, maxEscrow, maxAppraisalSpend verified before each action</span>
            </li>
          </ul>
        </article>

        <article className="card">
          <h3>Production (Passkey / Smart Account Kit)</h3>
          <ul className="keeper-list">
            <li>
              <strong>Principal</strong>
              <span>WebAuthn passkey controls OZ Smart Account</span>
            </li>
            <li>
              <strong>Session signer</strong>
              <span>Policy signer or context rule scoped to Round contract + caps</span>
            </li>
            <li>
              <strong>Relayer</strong>
              <span>Optional OZ Relayer channels for sponsored submit (scored flex)</span>
            </li>
          </ul>
        </article>
      </div>

      <aside className="callout">
        <strong>On-chain vs off-chain caps:</strong> {CAP_SAFETY_COPY.notOnChain} Passkey
        policies can mirror mandate caps at the wallet layer; escrow remains the Soroban-enforced
        ceiling at reveal.
      </aside>

      <article className="card passkey-demo">
        <div>
          <h3>Passkey-Kit wallet demo</h3>
          <p className="muted">
            WebAuthn: <strong>{passkeyAvailable ? "available" : "unavailable"}</strong> / RP ID:{" "}
            <code className="tiny">{rpId}</code>
            {walletWasmHash && (
              <>
                {" "}
                / WASM: <code className="tiny">{walletWasmHash.slice(0, 12)}…</code>
              </>
            )}
          </p>
          <p className={`passkey-status ${status}`}>{message}</p>
          {panelError && (
            <div className="callout callout-error" role="alert" data-testid="passkey-error">
              <strong className="error-name">{panelError.name}</strong>: {message}
            </div>
          )}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            disabled={status === "loading" || !passkeyAvailable}
            onClick={() => void createDemoKey()}
          >
            Create passkey
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={status === "loading" || !passkeyAvailable}
            onClick={() => void deploySmartWallet()}
          >
            Deploy smart wallet (testnet)
          </button>
          {session && (
            <button
              type="button"
              className="btn secondary"
              data-testid="passkey-commit-btn"
              disabled={status === "loading"}
              onClick={() => void commitWithPasskey()}
            >
              Commit bid (passkey)
            </button>
          )}
        </div>
        {(wallet || session) && (
          <dl className="kv">
            {session && (
              <>
                <dt>session contractId</dt>
                <dd>
                  <code className="tiny">{session.contractId}</code>
                </dd>
                <dt>session network</dt>
                <dd>
                  <code className="tiny">{session.networkPassphrase}</code>
                </dd>
                <dt>session account</dt>
                <dd>
                  <code className="tiny">{session.account}</code>
                </dd>
              </>
            )}
            {wallet?.keyId && (
              <>
                <dt>keyId</dt>
                <dd>
                  <code className="tiny">{wallet.keyId}</code>
                </dd>
              </>
            )}
            {wallet?.publicKey && (
              <>
                <dt>secp256r1 publicKey</dt>
                <dd>
                  <code className="tiny">{wallet.publicKey}</code>
                </dd>
              </>
            )}
            {wallet?.contractId && (
              <>
                <dt>contractId</dt>
                <dd>
                  <code className="tiny">{wallet.contractId}</code>
                </dd>
              </>
            )}
          </dl>
        )}
      </article>

      <ul className="link-list">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noreferrer">
              {l.label}
            </a>
            <span className="muted">{l.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
