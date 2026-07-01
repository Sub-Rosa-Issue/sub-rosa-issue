import {
  Address as SorobanAddress,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  type Keypair,
  type Transaction
} from "@stellar/stellar-sdk";
import type { SorobanOrderData, SorobanOrderStatus } from "../types/index.js";
import { assertNetworkConfig } from "../network.js";

export interface SorobanHTLCClientOptions {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Contract id of the deployed `oversync-htlc` contract. */
  contractId: string;
  /** Allow plain HTTP (for local sandboxes). */
  allowHttp?: boolean;
}

export interface SorobanCreateOrderInput {
  sender: string;
  beneficiary: string;
  refundAddress: string;
  /** Stellar asset contract id (e.g. native asset contract or a SAC). */
  asset: string;
  amount: bigint;
  safetyDeposit: bigint;
  hashlockHex: `0x${string}`;
  timelockSeconds: number;
}

/**
 * Type-safe wrapper around the OverSync Soroban HTLC contract.
 *
 * The class builds the transaction envelopes; signing is delegated to
 * the caller's wallet (Freighter, headless keypair, etc) via a
 * `signTransaction` callback. This avoids the SDK holding any keys.
 */
export class SorobanHTLCClient {
  public readonly contractId: string;
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;

  constructor(opts: SorobanHTLCClientOptions) {
    this.contractId = opts.contractId;
    this.server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.allowHttp ?? false });
    this.contract = new Contract(opts.contractId);
    this.networkPassphrase = opts.networkPassphrase ?? Networks.TESTNET;
    assertNetworkConfig({
      networkPassphrase: this.networkPassphrase,
      rpcUrl: opts.rpcUrl,
      allowHttp: opts.allowHttp,
    });
  }

  private async buildTx(
    callerAccountId: string,
    operation: ReturnType<Contract["call"]>
  ): Promise<Transaction> {
    const account = await this.server.getAccount(callerAccountId);
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(operation)
      .setTimeout(180)
      .build();
  }

  private hexToBytesN32(hex: `0x${string}`): Buffer {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length !== 64) {
      throw new Error("hashlock must be exactly 32 bytes (64 hex chars)");
    }
    return Buffer.from(clean, "hex");
  }

  /**
   * Build, simulate, sign and submit a `create_order` transaction.
   * Returns the on-chain transaction hash.
   */
  async createOrder(
    input: SorobanCreateOrderInput,
    signer: SorobanSigner
  ): Promise<string> {
    const op = this.contract.call(
      "create_order",
      new SorobanAddress(input.sender).toScVal(),
      new SorobanAddress(input.beneficiary).toScVal(),
      new SorobanAddress(input.refundAddress).toScVal(),
      new SorobanAddress(input.asset).toScVal(),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.safetyDeposit, { type: "i128" }),
      nativeToScVal(this.hexToBytesN32(input.hashlockHex), { type: "bytes" }),
      nativeToScVal(input.timelockSeconds, { type: "u64" })
    );
    return this.simulateSignSubmit(input.sender, op, signer);
  }

  async claimOrder(
    callerAccountId: string,
    orderId: bigint,
    preimageHex: `0x${string}`,
    signer: SorobanSigner
  ): Promise<string> {
    const clean = preimageHex.startsWith("0x") ? preimageHex.slice(2) : preimageHex;
    const op = this.contract.call(
      "claim_order",
      nativeToScVal(orderId, { type: "u64" }),
      nativeToScVal(Buffer.from(clean, "hex"), { type: "bytes" }),
      new SorobanAddress(callerAccountId).toScVal()
    );
    return this.simulateSignSubmit(callerAccountId, op, signer);
  }

  async refundOrder(
    callerAccountId: string,
    orderId: bigint,
    signer: SorobanSigner
  ): Promise<string> {
    const op = this.contract.call(
      "refund_order",
      nativeToScVal(orderId, { type: "u64" }),
      new SorobanAddress(callerAccountId).toScVal()
    );
    return this.simulateSignSubmit(callerAccountId, op, signer);
  }

  async getOrder(orderId: bigint): Promise<SorobanOrderData | null> {
    const op = this.contract.call(
      "get_order",
      nativeToScVal(orderId, { type: "u64" })
    );
    const sourceAccount = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422";
    const account = { accountId: () => sourceAccount, sequenceNumber: () => "0", incrementSequenceNumber: () => {} } as any;
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(op)
      .setTimeout(180)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if ("error" in sim && sim.error) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    const result = (sim as any).result;
    if (!result || !result.retval) return null;
    const native = scValToNative(result.retval);
    return parseSorobanOrder(native);
  }

  private async simulateSignSubmit(
    sourceAccountId: string,
    op: ReturnType<Contract["call"]>,
    signer: SorobanSigner
  ): Promise<string> {
    let tx = await this.buildTx(sourceAccountId, op);
    const sim = await this.server.simulateTransaction(tx);
    if ("error" in sim && sim.error) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    tx = rpc.assembleTransaction(tx, sim).build();
    const signedXdr = await signer({
      xdr: tx.toXDR(),
      networkPassphrase: this.networkPassphrase,
      publicKey: sourceAccountId
    });
    const signedTx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase) as Transaction;
    const submitted = await this.server.sendTransaction(signedTx);
    if (submitted.status === "ERROR") {
      throw new Error(`Submit failed: ${submitted.errorResult?.toXDR("base64") ?? "unknown"}`);
    }
    return submitted.hash;
  }
}

/**
 * Callback used by the SDK to delegate signing to whichever wallet the
 * caller is using. Implementations include:
 *
 *   - Freighter API in the browser
 *   - A direct `Keypair.sign()` call for headless services
 *   - WalletConnect bridges
 */
export type SorobanSigner = (req: {
  xdr: string;
  networkPassphrase: string;
  publicKey: string;
}) => Promise<string>;

/**
 * Convenience signer for headless use (resolvers, CI). NEVER use in
 * the browser — exposes the secret key to the calling code.
 */
export function makeKeypairSigner(keypair: Keypair): SorobanSigner {
  return async (req) => {
    const tx = TransactionBuilder.fromXDR(req.xdr, req.networkPassphrase) as Transaction;
    tx.sign(keypair);
    return tx.toXDR();
  };
}

// ---------------------------------------------------------------
// Soroban order parsing helpers
// ---------------------------------------------------------------

const STATUS_MAP: Record<string, SorobanOrderStatus> = {
  Funded: "Funded",
  Claimed: "Claimed",
  Refunded: "Refunded",
};

function bytesToHex(value: unknown): `0x${string}` {
  if (value instanceof Uint8Array || Buffer.isBuffer(value as Buffer)) {
    return ("0x" +
      Array.from(value as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
  }
  if (typeof value === "string") {
    // Already a hex string (some SDK versions surface as string).
    return (value.startsWith("0x") ? value : "0x" + value) as `0x${string}`;
  }
  throw new Error(`parseSorobanOrder: cannot convert value to hex: ${typeof value}`);
}

function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new Error(`parseSorobanOrder: field "${field}" is not a numeric type (got string "${value}")`);
    }
  }
  throw new Error(`parseSorobanOrder: field "${field}" is not a numeric type (got ${typeof value})`);
}

function toString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new Error(`parseSorobanOrder: field "${field}" is not a string (got ${typeof value})`);
}

/**
 * Parse/normalise a raw `scValToNative` return value from the Soroban
 * HTLC contract's `get_order` into a typed {@link SorobanOrderData}.
 *
 * Returns `null` when `raw` is null/undefined (order not found).
 * Throws a descriptive error for malformed payloads.
 *
 * This is exported as a pure function so callers that obtain the raw
 * value through other means (e.g. event streaming) can still benefit
 * from the typed normalisation.
 */
export function parseSorobanOrder(raw: unknown): SorobanOrderData | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`parseSorobanOrder: expected an object, got ${Array.isArray(raw) ? "array" : typeof raw}`);
  }

  const r = raw as Record<string, unknown>;

  const requiredFields = [
    "id", "sender", "beneficiary", "refund_address", "asset",
    "amount", "safety_deposit", "hashlock", "timelock",
    "status", "preimage", "created_at", "finalised_at",
  ] as const;

  for (const f of requiredFields) {
    if (!(f in r)) {
      throw new Error(`parseSorobanOrder: missing required field "${f}"`);
    }
  }

  const rawStatus = r["status"];
  const status: SorobanOrderStatus =
    typeof rawStatus === "string" && rawStatus in STATUS_MAP
      ? STATUS_MAP[rawStatus]
      : (() => { throw new Error(`parseSorobanOrder: unknown status value "${rawStatus}"`); })();

  // preimage is an empty Bytes in Funded state; normalise to "".
  let preimage: `0x${string}` | "" = "";
  const rawPreimage = r["preimage"];
  if (
    rawPreimage !== null &&
    rawPreimage !== undefined &&
    !(rawPreimage instanceof Uint8Array && rawPreimage.length === 0) &&
    !(Buffer.isBuffer(rawPreimage) && (rawPreimage as Buffer).length === 0) &&
    rawPreimage !== ""
  ) {
    preimage = bytesToHex(rawPreimage);
  }

  return {
    id: toBigInt(r["id"], "id"),
    sender: toString(r["sender"], "sender"),
    beneficiary: toString(r["beneficiary"], "beneficiary"),
    refundAddress: toString(r["refund_address"], "refund_address"),
    asset: toString(r["asset"], "asset"),
    amount: toBigInt(r["amount"], "amount"),
    safetyDeposit: toBigInt(r["safety_deposit"], "safety_deposit"),
    hashlock: bytesToHex(r["hashlock"]),
    timelock: toBigInt(r["timelock"], "timelock"),
    status,
    preimage,
    createdAt: toBigInt(r["created_at"], "created_at"),
    finalisedAt: toBigInt(r["finalised_at"], "finalised_at"),
  };
}
