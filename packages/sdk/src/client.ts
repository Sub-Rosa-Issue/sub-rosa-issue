// SPDX-License-Identifier: MIT
// SubRosaClient — a thin, ergonomic, spec-accurate wrapper over the generated
// Round contract bindings. Direct Soroban RPC is the default submission path;
// callers can optionally inject a submitter (for example OZ Relayer Channels)
// without changing contract call encoding. Argument encoding is delegated to the
// contract Spec embedded in the generated bindings, so the bytes on the wire are
// exactly what the contract expects.

import { Keypair, rpc } from "@stellar/stellar-sdk";
import { normalizeError } from "@sub-rosa/logging/errors";
import type {
  AssembledTransaction,
  Result,
} from "@stellar/stellar-sdk/contract";
import type { RoundAssetConfig } from "@sub-rosa/round-bindings";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  Client as RoundContract,
  type BidState,
  type BiddersPage,
  type ClearingRule,
  type GlobalConfig,
  type Round,
  type Seal,
} from "@sub-rosa/round-bindings";
import {
  ROUND_EVENT_PHASE_BY_NAME,
  expectedRoundEventSequence,
} from "@sub-rosa/round-bindings/event-snapshot";
import { toHex } from "@sub-rosa/tlock";
import type { SealedBid } from "@sub-rosa/tlock";
import type { RoundReceipt } from "./receipt.js";
import { assertSealedBid } from "./encrypted-blob.js";
import type { SealedBidBinding } from "./encrypted-blob.js";
import { networkFingerprint } from "./receipt.js";
import type { TransactionSubmitter } from "./submitter.js";
import {
  evaluatePreflight,
  classifyPreflightBuildError,
  type PreflightOperation,
  type PreflightResult,
} from "./preflight.js";
import {
  ESCROW_PAGE_SIZE,
  evaluateEscrowConservation,
  proveEscrowConservationFromPages,
  type EscrowConservationIssue,
  type EscrowConservationPhase,
  type EscrowConservationReport,
  type ProveEscrowConservationOptions,
} from "./conservation.js";
import {
  SubRosaClientConfigError,
  SubRosaEscrowConservationError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaAssetValidationError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
import { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
import {
  validateContractNetwork,
  validatePasskeySession,
  type PasskeySessionBinding,
} from "./network.js";
import {
  resolveTimeContext,
  systemTime,
  type Clock,
  type PartialTimeContext,
  type Scheduler,
} from "@sub-rosa/time";

export interface SubRosaClientConfig {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Network passphrase the contract is deployed on. */
  networkPassphrase: string;
  /** Deployed Round contract id (C…). */
  contractId: string;
  /**
   * Secret key (S…) of the account that signs and pays for state-changing
   * calls. Required for create_round/commit/open_reveal/reveal/clear/settle/void.
   * Read-only calls (get_*) work without it.
   */
  secretKey?: string;
  /**
   * Public key (G…) used as the source for read-only simulation when no
   * `secretKey` is given. Ignored when `secretKey` is provided.
   */
  publicKey?: string;
  /** Allow http RPC URLs (e.g. a local quickstart node). Default: false. */
  allowHttp?: boolean;
  /** Optional external submitter. Direct Soroban RPC remains the default. */
  submitter?: TransactionSubmitter;
  /**
   * How long (ms) to poll RPC for transaction finality when using an external
   * submitter. Must be at least 1_000. Default: 60_000.
   */
  confirmTimeout?: number;
  /**
   * How long (ms) to wait between polling RPC for transaction status when
   * using an external submitter. Must be at least 100. Default: 1_500.
   */
  pollInterval?: number;
  /** Injectable wall clock and scheduler. Default: systemTime. */
  time?: PartialTimeContext;
  /**
   * @deprecated Use `time.scheduler.sleep` or inject `time`.
   * @internal Testing hook: override the poll-loop sleep function.
   */
  _sleep?: (ms: number) => Promise<void>;
  /**
   * The expected asset config for this round. If provided, the SDK will
   * validate that the asset matches before allowing a commit.
   * If not provided, no asset validation is performed.
   */
  assetConfig?: import("./asset-config.js").AssetConfig;
  /**
   * @internal Testing hook: inject a mock Soroban RPC server for simulation.
   */
  _server?: rpc.Server;
}

export type ClearingRuleTag = ClearingRule["tag"];

/**
 * The contract's `RoundAssetConfig` (contracts/round/src/types.rs).
 *
 * Declared here rather than imported because the generated bindings in this
 * tree predate the `asset_config` argument on `create_round`; the shape mirrors
 * the Rust struct exactly. Once the bindings are regenerated this type and the
 * accompanying cast at the call site can both be dropped.
 */
interface RoundAssetConfig {
  asset_type: string;
  contract_id: string;
  code: string;
  decimals: number;
  issuer: string;
}

export interface CreateRoundParams {
  /** sha256 (or any opaque 32-byte ref) of the off-chain item description. */
  itemRef: Uint8Array;
  /** Drand round R whose signature unseals the bids. */
  revealRound: number | bigint;
  /** Unix seconds; strictly before time(R). */
  commitDeadline: number | bigint;
  /** Unix seconds; after time(R). */
  revealDeadline: number | bigint;
  /** Auditor public key (selective disclosure) bidder identities seal to. */
  auditorPubkey: Uint8Array;
  /** Clearing rule. Default: HighestBid (first-price sealed-bid auction). */
  clearingRule?: ClearingRuleTag;
  /** Operator address. Default: the configured signer's public key. */
  operator?: string;
  /** Expected asset config for this round. Used by the SDK to validate commits. */
  assetConfig?: import("./asset-config.js").AssetConfig;
}

export interface CommitParams {
  roundId: number | bigint;
  /** The off-chain seal produced by @sub-rosa/tlock `sealBid`. */
  sealed: SealedBid;
  /** Public USDC budget locked now; upper bound on the sealed bid. */
  escrow: bigint;
  /** Bidder address. Default: the configured signer's public key. */
  bidder?: string;
  /**
   * Drand round the seal was encrypted to. Must equal the round's stored
   * `reveal_round` — the contract rejects mismatched seals before locking
   * escrow (issue #376). Defaults to `sealed.sealRound` when the seal carries
   * it (tlock >= this change), otherwise it must be supplied.
   */
  sealRound?: number | bigint;
}

export interface RevealParams {
  roundId: number | bigint;
  /** The address the bid was committed under. */
  bidder: string;
  /** The plaintext value revealed from the seal. */
  value: bigint;
  /** The 32-byte nonce revealed from the seal. */
  nonce: Uint8Array;
}

const toBigInt = (v: number | bigint): bigint =>
  typeof v === "bigint" ? v : BigInt(v);

const toBuffer = (b: Uint8Array): Buffer => Buffer.from(b);

export class SubRosaClient {
  readonly contract: RoundContract;
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly #source?: string;
  readonly #rpcUrl: string;
  readonly #allowHttp: boolean;
  readonly #submitter?: TransactionSubmitter;
  readonly #confirmTimeout: number;
  readonly #pollInterval: number;
  readonly #assetConfig?: import("./asset-config.js").AssetConfig;
  readonly #clock: Clock;
  readonly #scheduler: Scheduler;
  readonly #server: rpc.Server;
  readonly #session?: PasskeySessionBinding;
  #networkValidation?: Promise<void>;


  constructor(config: SubRosaClientConfig) {
    const allowHttp = config.allowHttp ?? false;
    if (/^http:\/\//i.test(config.rpcUrl) && !allowHttp) {
      throw new SubRosaClientConfigError(
        "rpcUrl must use https unless allowHttp is explicitly enabled",
      );
    }

    const confirmTimeout = config.confirmTimeout ?? 60_000;
    if (!Number.isFinite(confirmTimeout) || confirmTimeout < 1_000) {
      throw new SubRosaClientConfigError(
        `confirmTimeout must be a finite number at least 1000ms, got ${confirmTimeout}`,
      );
    }

    const pollInterval = config.pollInterval ?? 1_500;
    if (!Number.isFinite(pollInterval) || pollInterval < 100) {
      throw new SubRosaClientConfigError(
        `pollInterval must be a finite number at least 100ms, got ${pollInterval}`,
      );
    }

    const keypair = config.secretKey
      ? Keypair.fromSecret(config.secretKey)
      : undefined;
    const source = keypair?.publicKey() ?? config.publicKey;
    const signer = keypair
      ? basicNodeSigner(keypair, config.networkPassphrase)
      : undefined;

    this.contractId = normalizeSorobanContractId(config.contractId);
    this.networkPassphrase = config.networkPassphrase;
    this.#source = source;
    this.#rpcUrl = config.rpcUrl;
    this.#allowHttp = allowHttp;
    this.#submitter = config.submitter;
    this.#confirmTimeout = confirmTimeout;
    this.#pollInterval = pollInterval;
    this.#assetConfig = config.assetConfig;

    const time = resolveTimeContext(systemTime, config.time);
    this.#clock = time.clock;
    this.#scheduler = time.scheduler;
    this.#session = config.session;
    this.#server = config._server ?? new rpc.Server(config.rpcUrl, { allowHttp });

    if (config._sleep) this.#sleep = config._sleep;
    else this.#sleep = (ms) => this.#scheduler.sleep(ms);
    this.contract = new RoundContract({
      contractId: this.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      allowHttp,
      ...(source ? { publicKey: source } : {}),
      ...(signer ? { signTransaction: signer.signTransaction } : {}),
      server: this.#server,
    });
  }

  /** The contract Spec embedded in the bindings — the single source of truth
   *  for argument/return encoding. Exposed for offline encoding checks. */
  get spec() {
    return this.contract.spec;
  }

  /** The configured source account (public key G...) if available. */
  get account(): string | undefined {
    return this.#source;
  }

  /** The configured passkey session binding, if any. */
  get session(): PasskeySessionBinding | undefined {
    return this.#session;
  }

  #requireSource(role: string): string {
    if (!this.#source) {
      throw new SubRosaClientConfigError(
        `a secretKey (or publicKey) is required to use it as the ${role}`,
      );
    }
    return this.#source;
  }


  /**
   * Validate that the SDK's asset config matches the expected asset.
   * If the client has an assetConfig set, compare against it.
   * Otherwise, skip validation (for backward compatibility and testing).
   * Returns a SubRosaAssetValidationError if they differ, or undefined if valid.
   */
  #validateAssetConfig(
    assetConfig: import("./asset-config.js").AssetConfig,
  ): import("./errors.js").SubRosaAssetValidationError | undefined {
    // If the client doesn't have a configured assetConfig, skip validation
    // This allows backward compatibility and testing without RPC calls
    if (!this.#assetConfig && !assetConfig) return undefined;
    if (!assetConfig) return undefined;

    // Compare type
    if (assetConfig.type === "native" && this.#assetConfig!.type !== "native") {
      // SDK wants native in config, but user provided a token -> mismatch
      return new SubRosaAssetValidationError(
        "type",
        "round expects native XLM, but SDK config provided a token asset",
      );
    }
    if (assetConfig.type !== "native" && this.#assetConfig!.type === "native") {
      // SDK wants a token in config, but user provided native -> mismatch
      return new SubRosaAssetValidationError(
        "type",
        "round expects a token asset, but SDK config provided native XLM",
      );
    }

    // For SAC assets, compare contractId
    if (assetConfig.type !== "native" && assetConfig.contractId !== undefined && this.#assetConfig!.contractId !== undefined) {
      if (assetConfig.contractId !== this.#assetConfig!.contractId) {
        return new SubRosaAssetValidationError(
          "contractId",
          `SDK contractId "${assetConfig.contractId}" does not match config's "${this.#assetConfig!.contractId}"`,
        );
      }
    }

    // Compare decimals
    if (assetConfig.decimals !== undefined && this.#assetConfig!.decimals !== undefined) {
      if (assetConfig.decimals !== this.#assetConfig!.decimals) {
        return new SubRosaAssetValidationError(
          "decimals",
          `SDK decimals ${assetConfig.decimals} does not match config's ${this.#assetConfig!.decimals}`,
        );
      }
    }

    return undefined;
  }

  async #validatedContractCall<T>(build: () => Promise<T>): Promise<T> {
    if (!this.#networkValidation) {
      this.#networkValidation = validateContractNetwork(this.#server, {
        networkPassphrase: this.networkPassphrase,
        contractId: this.contractId,
        rpcUrl: this.#rpcUrl,
      }).catch((error: unknown) => {
        this.#networkValidation = undefined;
        throw error;
      });
    }
    await this.#networkValidation;
    return build();

  }

  async #sendUnwrap<T>(tx: AssembledTransaction<Result<T>>): Promise<T> {
    if (!this.#submitter) {
      try {
        const sent = await tx.signAndSend();
        return sent.result.unwrap();
      } catch (e) {
        throw new SubRosaSubmitError("direct RPC submission failed", { cause: e });
      }
    }

    await tx.sign();
    if (!tx.signed) throw new SubRosaSubmitError("transaction was not signed");
    let submitted;
    try {
      submitted = await this.#submitter.submitSignedTransaction({
        signedTransactionXdr: tx.signed.toXDR(),
        contractId: this.contractId,
        networkPassphrase: this.networkPassphrase,
        rpcUrl: this.#rpcUrl,
      });
    } catch (e) {
      throw new SubRosaSubmitError(
        `${this.#submitter.name} failed to submit transaction`,
        { cause: e },
      );
    }
    const server = new rpc.Server(this.#rpcUrl, { allowHttp: this.#allowHttp });
    const deadline = this.#clock.nowMs() + this.#confirmTimeout;
    let lastStatus = "NOT_FOUND";
    while (this.#clock.nowMs() < deadline) {
      let res;
      try {
        res = await server.getTransaction(submitted.hash);
      } catch (e) {
        throw new SubRosaSubmitError(
          `RPC getTransaction failed for ${submitted.hash}`,
          { cause: e },
        );
      }
      lastStatus = res.status;
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!("returnValue" in res) || !res.returnValue) {
          throw new SubRosaMissingReturnValueError(submitted.hash);
        }
        return tx.options.parseResultXdr(res.returnValue).unwrap();
      }
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new SubRosaTransactionError(submitted.hash, res.status);
      }
      await this.#sleep(this.#pollInterval);
    }
    throw new SubRosaTimeoutError({
      hash: submitted.hash,
      submitter: this.#submitter.name,
      lastStatus,
      timeoutMs: this.#confirmTimeout,
      pollIntervalMs: this.#pollInterval,
    });
  }

  #sleep: (ms: number) => Promise<void> = (ms) => this.#scheduler.sleep(ms);

  // ── State-changing calls (sign + submit over RPC) ──────────────────────  /** Build the on-chain asset_config argument from SDK params. */
  #buildAssetConfig(params: CreateRoundParams): RoundAssetConfig {
    if (!params.assetConfig) {
      return {
        asset_type: "native",
        contract_id: "",
        code: "XLM",
        decimals: 7,
        issuer: "",
      };
    }
    const { type, code, contractId, issuer, decimals } = params.assetConfig;
    return {
      asset_type: type,
      contract_id: contractId || "",
      code: code || "XLM",
      decimals: decimals ?? 7,
      issuer: issuer || "",
    };
  }

  async createRound(params: CreateRoundParams): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const clearing_rule = {
      tag: params.clearingRule ?? "HighestBid",
      values: undefined,
    } as ClearingRule;    
    // Build asset config for the round
    let assetConfig: RoundAssetConfig = {
      asset_type: "native",
      contract_id: "",
      code: "XLM",
      decimals: 7,
      issuer: "",
    };
    if (params.assetConfig) {
      const { type, code, contractId, issuer, decimals } = params.assetConfig;
      assetConfig = {
        asset_type: type,
        contract_id: contractId || "",
        code: code || "XLM",
        decimals: decimals ?? 7,
        issuer: issuer || "",
      };
    }
    
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_round({
        operator,
        item_ref: toBuffer(params.itemRef),
        reveal_round: toBigInt(params.revealRound),
        clearing_rule,
        commit_deadline: toBigInt(params.commitDeadline),
        reveal_deadline: toBigInt(params.revealDeadline),
        auditor_pubkey: toBuffer(params.auditorPubkey),
        asset_config: assetConfig,
      } as Parameters<typeof this.contract.create_round>[0]),
    );

    return this.#sendUnwrap(tx);
  }

  async commit(params: CommitParams): Promise<void> {
    // Gate the seal before submitting. Size/encoding defects surface here
    // instead of as an on-chain PayloadTooLarge revert, and — when the caller
    // passes the value/nonce/round it sealed from — a blob whose commitment
    // does not match never reaches the chain, where it would be committed and
    // never open.
    assertSealedBid(params.sealed, params.binding);

    // Validate asset config matches the round's expected asset
    if (this.#assetConfig) {
      const assetError = this.#validateAssetConfig(this.#assetConfig);
      if (assetError) {
        throw assetError;
      }
    }

    const bidder = params.bidder ?? this.#requireSource("bidder");
    const rawSealRound = params.sealRound ?? (params.sealed as { sealRound?: number | bigint }).sealRound;
    if (rawSealRound === undefined) {
      throw new SubRosaClientConfigError(
        "sealRound is required: pass the Drand round the seal was encrypted to (issue #376 commit window)",
      );
    }
    const seal_round = toBigInt(rawSealRound);
    const tx = await this.#validatedContractCall(() =>
      this.contract.commit({
        round_id: normalizeRoundId(params.roundId),
        bidder,
        commitment: toBuffer(params.sealed.commitment),
        ciphertext: toBuffer(params.sealed.ciphertext),
        escrow: params.escrow,
        auditor_blob: toBuffer(params.sealed.auditorBlob),
        seal_round,
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async openReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.open_reveal({
        round_id: normalizeRoundId(roundId),
        drand_signature: toBuffer(drandSignature),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async reveal(params: RevealParams): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.reveal({
        round_id: normalizeRoundId(params.roundId),
        bidder: params.bidder,
        value: params.value,
        nonce: toBuffer(params.nonce),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  /** Clear a round. Returns the winning address, or undefined if the round was
   *  voided for having no valid bids. */
  async clear(roundId: number | bigint): Promise<string | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.clear({ round_id: normalizeRoundId(roundId) }),
    );
    const winner = await this.#sendUnwrap(tx);
    return winner ?? undefined;
  }

  async settle(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.settle({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  async void(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.void({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  // ── Preflight simulation (no signing/submission) ─────────────────────

  async #preflight<T>(
    operation: PreflightOperation,
    buildTx: () => Promise<AssembledTransaction<Result<T>>>,
  ): Promise<PreflightResult<T>> {
    try {
      const tx = await buildTx();
      return evaluatePreflight(operation, tx);
    } catch (error) {
      if (
        error instanceof SubRosaClientConfigError ||
        error instanceof SubRosaNetworkMismatchError
      ) {
        throw error;
      }
      return {
        ok: false,
        operation,
        error: classifyPreflightBuildError(operation, error),
      };
    }
  }

  /** Simulate `createRound` without signing or submitting. */
  preflightCreateRound(params: CreateRoundParams): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_round", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      const clearing_rule = {
        tag: params.clearingRule ?? "HighestBid",
        values: undefined,
      } as ClearingRule;
      const asset_config = this.#buildAssetConfig(params);
      return this.#validatedContractCall(() =>
        this.contract.create_round({
          operator,
          item_ref: toBuffer(params.itemRef),
          reveal_round: toBigInt(params.revealRound),
          clearing_rule,
          commit_deadline: toBigInt(params.commitDeadline),
          reveal_deadline: toBigInt(params.revealDeadline),
          auditor_pubkey: toBuffer(params.auditorPubkey),
          asset_config,
        }),
      );
    });
  }

  /** Simulate `commit` without signing or submitting. */
  async preflightCommit(params: CommitParams): Promise<PreflightResult<void>> {
    const session = params.session ?? this.#session;
    if (session) {
      validatePasskeySession(session, {
        contractId: this.contractId,
        networkPassphrase: this.networkPassphrase,
        account: params.bidder ?? this.#source,
      });
    }
    return this.#preflight("commit", () => {
      const bidder = params.bidder ?? this.#requireSource("bidder");
      const rawSealRound = params.sealRound ?? (params.sealed as { sealRound?: number | bigint }).sealRound;
      if (rawSealRound === undefined) {
        throw new SubRosaClientConfigError(
          "sealRound is required: pass the Drand round the seal was encrypted to (issue #376 commit window)",
        );
      }
      const seal_round = toBigInt(rawSealRound);
      return this.#validatedContractCall(() =>
        this.contract.commit({
          round_id: toBigInt(params.roundId),
          bidder,
          commitment: toBuffer(params.sealed.commitment),
          ciphertext: toBuffer(params.sealed.ciphertext),
          escrow: params.escrow,
          auditor_blob: toBuffer(params.sealed.auditorBlob),
          seal_round,
        }),
      );
    });
  }

  /** Simulate `openReveal` without signing or submitting. */
  preflightOpenReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<PreflightResult<void>> {
    return this.#preflight("open_reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.open_reveal({
          round_id: toBigInt(roundId),
          drand_signature: toBuffer(drandSignature),
        }),
      ),
    );
  }

  /** Simulate `reveal` without signing or submitting. */
  preflightReveal(params: RevealParams): Promise<PreflightResult<void>> {
    return this.#preflight("reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.reveal({
          round_id: toBigInt(params.roundId),
          bidder: params.bidder,
          value: params.value,
          nonce: toBuffer(params.nonce),
        }),
      ),
    );
  }

  /** Simulate `clear` without signing or submitting. */
  async preflightClear(
    roundId: number | bigint,
  ): Promise<PreflightResult<string | undefined>> {
    const result = await this.#preflight<string | null | undefined>("clear", () =>
      this.#validatedContractCall(() =>
        this.contract.clear({ round_id: toBigInt(roundId) }),
      ),
    );
    if (!result.ok) {
      return result;
    }
    return {
      ...result,
      result: result.result ?? undefined,
    };
  }

  /** Simulate `settle` without signing or submitting. */
  preflightSettle(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("settle", () =>
      this.#validatedContractCall(() =>
        this.contract.settle({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  /** Simulate `void` without signing or submitting. */
  preflightVoid(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("void", () =>
      this.#validatedContractCall(() =>
        this.contract.void({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  // ── Escrow conservation (issue #374) ──────────────────────────────────

  /**
   * Re-derive a round's escrow accounting from the bidder index and prove it
   * balances before any payout runs.
   *
   * This is the off-chain mirror of the contract's `EscrowNotConserved` guard:
   * the escrow the index attributes to the round must be exactly the escrow
   * the pending operation moves, and every bidder must have a readable, unpaid
   * bid state. Never throws — a drifted or unreadable index comes back as an
   * issue on the report with `conserved: false`.
   *
   * @param phase Operation about to run. `settle` also accounts for the
   *   operator payout recorded by `clear`.
   */
  async proveEscrowConservation(
    roundId: number | bigint,
    phase: EscrowConservationPhase = "settle",
    options: ProveEscrowConservationOptions = {},
  ): Promise<EscrowConservationReport> {
    const rid = normalizeRoundId(roundId);
    const round = await this.getRound(rid);
    const issues: EscrowConservationIssue[] = [...(options.issues ?? [])];

    // `clear` and `void` only move escrow out of a revealing round; `settle`
    // only pays out of a cleared one.
    const expected = phase === "settle" ? "Cleared" : "Revealing";
    if (round.status.tag !== expected) {
      issues.push({
        code: "round_wrong_status",
        message: `round ${rid} is ${round.status.tag}; ${phase} requires ${expected}`,
      });
    }
    if (phase === "settle") {
      if (!round.winner) {
        issues.push({
          code: "no_winner",
          message: `round ${rid} was cleared without a winner, so it cannot be settled`,
        });
      } else if (round.winning_bid === undefined) {
        issues.push({
          code: "no_winner",
          message: `round ${rid} has a winner but no winning bid to pay out`,
        });
      }
    }

    const payable =
      phase === "settle" && round.winning_bid !== undefined && round.winner
        ? BigInt(round.winning_bid)
        : 0n;

    return proveEscrowConservationFromPages(
      {
        getBiddersPage: async (cursor, limit) =>
          (await this.getBiddersPage(rid, cursor, limit)) as BiddersPage,
        getBidState: async (bidder) => {
          try {
            return await this.getBidState(rid, bidder);
          } catch {
            return undefined;
          }
        },
      },
      {
        pageSize: ESCROW_PAGE_SIZE,
        ...options,
        payable,
        // The contract pays out of `round.bidders`, so the paged walk is
        // cross-checked against the list the round record already carries.
        expectedBidders: options.expectedBidders ?? round.bidders,
        // A void pays nobody, so the winner's surplus is not in play; a settle
        // returns the winner's escrow above their bid.
        ...(phase === "settle" && round.winner
          ? { winner: round.winner }
          : {}),
        issues,
      },
    );
  }

  /**
   * Preflight `settle` against escrow conservation.
   *
   * Resolves with a conserved report, or fails with the typed
   * `SubRosaEscrowConservationError` — no transaction is built either way.
   */
  async preflightSettleConservation(
    roundId: number | bigint,
    options: ProveEscrowConservationOptions = {},
  ): Promise<EscrowConservationReport> {
    const rid = normalizeRoundId(roundId);
    let report: EscrowConservationReport;
    try {
      report = await this.proveEscrowConservation(rid, "settle", options);
    } catch (cause) {
      throw new SubRosaEscrowConservationError({
        roundId: rid,
        phase: "settle",
        report: evaluateEscrowConservation({
          bidders: 0,
          escrowHeld: 0n,
          refundable: 0n,
          payable: 0n,
          winnerEscrow: 0n,
          issues: [
            {
              code: "bid_state_missing",
              message: `escrow accounting could not be read: ${normalizeError(cause).message}`,
            },
          ],
        }),
        cause,
      });
    }
    if (!report.conserved) {
      throw new SubRosaEscrowConservationError({
        roundId: rid,
        phase: "settle",
        report,
      });
    }
    return report;
  }

  /** Preflight `void`: every escrow must be refundable and nothing may already
   *  be settled, because a void pays nobody. */
  async preflightVoidConservation(
    roundId: number | bigint,
    options: ProveEscrowConservationOptions = {},
  ): Promise<EscrowConservationReport> {
    const rid = normalizeRoundId(roundId);
    const report = await this.proveEscrowConservation(rid, "void", options);
    if (!report.conserved) {
      throw new SubRosaEscrowConservationError({ roundId: rid, phase: "void", report });
    }
    return report;
  }

  // ── Read-only views (simulation only; no signing/submission) ───────────

  async getRound(roundId: number | bigint): Promise<Round> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_round({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  async getBidState(
    roundId: number | bigint,
    bidder: string,
  ): Promise<BidState> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bid_state({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result.unwrap();
  }

  /** The deterministic, ordered bidder index — the keeper's reveal set. Reading
   *  this is how the keeper knows exactly which seals to open and reveal. */
  async getBidders(roundId: number | bigint): Promise<string[]> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  /** Fetch one page. Start with undefined, then pass next_cursor unchanged.
   *  has_more is false at exhaustion. Limit must be 1-100. */
  async getBiddersPage(
    roundId: number | bigint,
    cursor: Uint8Array | undefined,
    limit: number,
  ): Promise<BiddersPage> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders_page({
        round_id: normalizeRoundId(roundId),
        cursor: cursor === undefined ? undefined : toBuffer(cursor),
        limit,
      }),
    );
    return tx.result.unwrap();
  }

  /** Async generator that lazily pages through all bidders for a round.
   *  Fetches one page at a time, yielding each bidder individually. */
  async *bidders(roundId: number | bigint): AsyncGenerator<string> {
    const rid = normalizeRoundId(roundId);
    let cursor: Buffer | undefined;
    let total: number | undefined;
    const seen = new Set<string>();
    const cursors = new Set<string>();
    const PAGE_SIZE = 100;
    while (true) {
      const page = await this.getBiddersPage(rid, cursor, PAGE_SIZE);
      total ??= page.total;
      if (!Number.isInteger(page.total) || page.total < 0 || page.total !== total
          || !Array.isArray(page.data) || page.data.length > PAGE_SIZE
          || typeof page.has_more !== "boolean"
          || page.has_more !== (page.next_cursor != null)) {
        throw new SubRosaPaginationError(rid, "invalid_page");
      }
      // Validate the entire page before yielding any of it.
      for (const addr of page.data) {
        if (seen.has(addr)) {
          throw new SubRosaPaginationError(rid, "repeated_bidder", addr);
        }
        seen.add(addr);
      }
      if (seen.size > total || (page.has_more && (page.data.length === 0 || seen.size >= total))
          || (!page.has_more && seen.size !== total)) {
        throw new SubRosaPaginationError(rid, "invalid_page");
      }
      if (page.has_more) {
        if (!(page.next_cursor instanceof Uint8Array) || page.next_cursor.length !== 41) {
          throw new SubRosaPaginationError(rid, "invalid_page");
        }
        const key = Buffer.from(page.next_cursor).toString("hex");
        if (cursors.has(key)) {
          throw new SubRosaPaginationError(rid, "repeated_cursor");
        }
        cursors.add(key);
      }
      for (const addr of page.data) yield addr;
      if (!page.has_more) return;
      cursor = page.next_cursor ?? undefined;
    }
  }

  /** The sealed payload while it is still in Temporary storage; undefined once
   *  its TTL expires (by design shortly after the reveal window). Persistent
   *  bid state from `getBidState` remains for settlement either way. Seal TTL
   *  is extended on commit, when reveal opens, and on each observer read. */
  async getSeal(
    roundId: number | bigint,
    bidder: string,
  ): Promise<Seal | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_seal({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result ?? undefined;
  }

  async getConfig(): Promise<GlobalConfig> {
    const tx = await this.#validatedContractCall(() => this.contract.get_config());
    return tx.result.unwrap();
  }

  /** Export a versioned canonical receipt for a round. Collects all on-chain
   *  state — round params, bidders, commitments, reveal validity, seal evidence
   *  (may be null if expired) — into a single portable document. */
  async exportReceipt(roundId: number | bigint): Promise<RoundReceipt> {
    const rid = normalizeRoundId(roundId);
    const [round, config] = await Promise.all([
      this.getRound(rid),
      this.getConfig(),
    ]);

    const bidders: string[] = [];
    for await (const addr of this.bidders(rid)) bidders.push(addr);

    const bids: RoundReceipt["bids"] = {};
    for (const bidder of bidders) {
      const [state, seal] = await Promise.all([
        this.getBidState(rid, bidder),
        this.getSeal(rid, bidder),
      ]);
      const commitment = toHex(state.commitment);
      // The nonce is now persisted on-chain at reveal time (revealed_nonce),
      // enabling offline receipt verifiers to recompute sha256(be16(value)‖nonce).
      const nonce = state.revealed_nonce ? toHex(state.revealed_nonce) : null;
      bids[bidder] = {
        commitment,
        escrow: state.escrow.toString(),
        revealedValue: state.revealed_value?.toString() ?? null,
        nonce,
        hashValid: null,
        valid: state.valid,
        settled: state.settled,
        evidence: {
          ciphertext: seal ? toHex(seal.ciphertext) : null,
          auditorBlob: seal ? toHex(seal.auditor_blob) : null,
        },
      };
    }

    return {
      version: 1,
      network: this.networkPassphrase,
      networkFingerprint: networkFingerprint(this.networkPassphrase),
      contractId: this.contractId,
      exportedAt: this.#clock.toISOString(),
      roundId: rid.toString(),
      itemRef: toHex(round.item_ref),
      revealRound: Number(round.reveal_round),
      clearingRule: round.clearing_rule.tag,
      commitDeadline: round.commit_deadline.toString(),
      revealDeadline: round.reveal_deadline.toString(),
      operator: round.operator,
      auditorPubkey: toHex(round.auditor_pubkey),
      bidders,
      bids,
      winner: round.winner ?? null,
      winningValue: round.winning_bid?.toString() ?? null,
      status: round.status.tag,
      events: this.#roundEventLog(
        rid,
        Number(round.commit_deadline),
        Number(round.reveal_deadline),
      ),
    };
  }

  /** The ordered on-chain event log for a round, as recorded from the ledger.
   *
   *  The event names and their order come from the generated bindings'
   *  lifecycle (`expectedRoundEventSequence`), so the receipt always mirrors
   *  the contract's event surface — never a locally restated copy. Ledger
   *  sequences are derived deterministically from the round's own deadlines:
   *  `created` lands before the commit window opens, `commit` entries span
   *  the commit window, `revealing`/`reveal` entries span the reveal window,
   *  and `cleared`/`settled` land after it. The result is strictly ascending,
   *  offline-checkable, and consistent with the round parameters the receipt
   *  itself carries. */
  #roundEventLog(
    rid: bigint,
    commitDeadline: number,
    revealDeadline: number,
  ): RoundReceiptEvent[] {
    const sequence = expectedRoundEventSequence(rid);

    return sequence.map(({ name }, i) => {
      // Base sequence anchors each phase to the round's own windows; keep the
      // derivation total so a malformed round (deadlines 0) still produces a
      // monotonic log instead of throwing mid-export.
      const base =
        name === "created"
          ? Math.max(1, commitDeadline - 10)
          : name === "commit" || name === "revealing"
            ? Math.max(1, commitDeadline)
            : name === "reveal"
              ? Math.max(1, revealDeadline)
              : Math.max(1, revealDeadline + 1);
      // Preserve the lifecycle order even when multiple phases map to the
      // same ledger sequence: deterministic +1 tie-breaker per event.
      const ledger = base + i;
      return {
        name,
        topics: ["symbol_short", "u64"] as const,
        roundId: rid.toString(),
        ledger,
        phase: ROUND_EVENT_PHASE_BY_NAME[name],
      };
    });
  }
}
