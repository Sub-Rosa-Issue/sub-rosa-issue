import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rpc, StrKey } from "@stellar/stellar-sdk";
import { SubRosaClient } from "./client.js";
import {
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
import type {
  SubmitSignedTransactionParams,
  TransactionSubmitter,
} from "./submitter.js";

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ",
};

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function assertConfigError(
  createClient: () => SubRosaClient,
  message: RegExp,
): void {
  assert.throws(createClient, (error: unknown) => {
    assert.ok(error instanceof SubRosaClientConfigError);
    assert.match(error.message, message);
    return true;
  });
}

describe("SubRosaClient network configuration", () => {
  it("rejects an HTTP RPC URL with a typed error by default", () => {
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
        }),
      /rpcUrl must use https unless allowHttp is explicitly enabled/,
    );
  });

  it("rejects an HTTP RPC URL when allowHttp is explicitly false", () => {
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
          allowHttp: false,
        }),
      /rpcUrl must use https unless allowHttp is explicitly enabled/,
    );
  });

  it("accepts an HTTP RPC URL when allowHttp is explicitly enabled", () => {
    assert.doesNotThrow(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
          allowHttp: true,
        }),
    );
  });
});

describe("SubRosaClient source configuration", () => {
  it("rejects createRound without an operator source using a typed error", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.createRound({
        itemRef: new Uint8Array(32),
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaClientConfigError);
        assert.match(error.message, /required to use it as the operator/);
        return true;
      },
    );
  });

  it("rejects commit without a bidder source using a typed error", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.commit({
        roundId: 1,
        sealed: {
          commitment: new Uint8Array(32),
          ciphertext: new Uint8Array([0x61, 0x67, 0x65]),
          auditorBlob: new Uint8Array(1),
        },
        escrow: 1n,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaClientConfigError);
        assert.match(error.message, /required to use it as the bidder/);
        return true;
      },
    );
  });
});

describe("SubRosaClient external submitter failures", () => {
  it("passes client options and wraps failures with name and cause", async () => {
    const cause = new Error("relayer offline");
    let received: SubmitSignedTransactionParams | undefined;
    const submitter: TransactionSubmitter = {
      name: "test-submitter",
      async submitSignedTransaction(params) {
        received = params;
        throw cause;
      },
    };
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
      submitter,
    });
    const fakeTransaction = {
      signed: {
        toXDR: () => "AAAA",
      },
      async sign() {},
      options: {
        parseResultXdr: () => {
          throw new Error("not reached");
        },
      },
    };

    Object.defineProperty(client.contract, "clear", {
      configurable: true,
      value: async () => fakeTransaction,
    });

    await assert.rejects(client.clear(1), (error: unknown) => {
      assert.ok(error instanceof SubRosaSubmitError);
      assert.match(error.message, /test-submitter failed to submit transaction/);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.deepEqual(received, {
      signedTransactionXdr: "AAAA",
      contractId: BASE_CONFIG.contractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      rpcUrl: BASE_CONFIG.rpcUrl,
    });
  });
});

// ---------------------------------------------------------------------------
// Network-free (unit) tests — no RPC calls, pure in-process contract mocks
// ---------------------------------------------------------------------------

const TESTNET = "Test SDF Network ; September 2015";

function newClient(config: Record<string, unknown> = {}) {
  return new SubRosaClient({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET,
    contractId: StrKey.encodeContract(Buffer.alloc(32)),
    ...config,
  });
}

const addr = (fill: number) =>
  StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
const u8 = (len: number, fill: number) => new Uint8Array(len).fill(fill);

describe("SubRosaClient (network-free behaviors)", () => {
  it("createRound converts numbers->bigint and bytes->Buffer, uses default operator", async () => {
    const pub = addr(3);
    const c = newClient({ publicKey: pub });

    let seenArgs: Record<string, unknown> | null = null;
    c.contract.create_round = async (args: Record<string, unknown>) => {
      seenArgs = args;
      return {
        signAndSend: async () => ({ result: { unwrap: () => 77n } }),
      } as any;
    };

    const itemRef = u8(32, 5);
    const aud = u8(96, 6);
    const out = await c.createRound({
      itemRef,
      revealRound: 42,
      commitDeadline: 1_000,
      revealDeadline: 2_000,
      auditorPubkey: aud,
    });

    assert.equal(out, 77n);
    assert.ok(seenArgs);
    assert.equal(seenArgs.operator, pub);
    assert.equal(typeof seenArgs.reveal_round, "bigint");
    assert.equal(typeof seenArgs.commit_deadline, "bigint");
    assert.equal(typeof seenArgs.reveal_deadline, "bigint");
    assert.ok(Buffer.isBuffer(seenArgs.item_ref));
    assert.ok(Buffer.isBuffer(seenArgs.auditor_pubkey));
  });

  it("commit rejects missing bidder/source", async () => {
    const c = newClient();
    await assert.rejects(
      () =>
        c.commit({
          roundId: 1,
          sealed: {
            commitment: u8(32, 1),
            ciphertext: u8(1, 2),
            auditorBlob: u8(0, 0),
          } as any,
          escrow: 1n,
        }),
      SubRosaClientConfigError,
    );
  });

  it("createRound uses direct signAndSend success path", async () => {
    const c = newClient({ publicKey: addr(1) });
    c.contract.create_round = async () => ({
      signAndSend: async () => ({ result: { unwrap: () => 88n } }),
    } as any);

    const out = await c.createRound({
      itemRef: u8(32, 1),
      revealRound: 1,
      commitDeadline: 1,
      revealDeadline: 2,
      auditorPubkey: u8(96, 2),
    });

    assert.equal(out, 88n);
  });

  it("commit defaults to the configured bidder when one is not supplied", async () => {
    const c = newClient({ publicKey: addr(2) });
    let seenArgs: any;
    c.contract.commit = async (args: any) => {
      seenArgs = args;
      return {
        signAndSend: async () => ({ result: { unwrap: () => undefined } }),
      } as any;
    };

    await c.commit({
      roundId: 7,
      sealed: { commitment: u8(32, 3), ciphertext: u8(1, 4), auditorBlob: u8(0, 0) } as any,
      escrow: 5n,
    });

    assert.equal(seenArgs.bidder, addr(2));
  });

  it("state-changing helpers wire through the corresponding contract methods", async () => {
    const c = newClient({ publicKey: addr(4) });
    const calls: Array<[string, any]> = [];

    c.contract.open_reveal = async (args: any) => {
      calls.push(["open_reveal", args]);
      return { signAndSend: async () => ({ result: { unwrap: () => undefined } }) } as any;
    };
    c.contract.reveal = async (args: any) => {
      calls.push(["reveal", args]);
      return { signAndSend: async () => ({ result: { unwrap: () => undefined } }) } as any;
    };
    c.contract.clear = async (args: any) => {
      calls.push(["clear", args]);
      return { signAndSend: async () => ({ result: { unwrap: () => "winner" } }) } as any;
    };
    c.contract.settle = async (args: any) => {
      calls.push(["settle", args]);
      return { signAndSend: async () => ({ result: { unwrap: () => undefined } }) } as any;
    };
    c.contract.void = async (args: any) => {
      calls.push(["void", args]);
      return { signAndSend: async () => ({ result: { unwrap: () => undefined } }) } as any;
    };

    await c.openReveal(9, u8(64, 5));
    await c.reveal({ roundId: 9, bidder: addr(6), value: 123n, nonce: u8(32, 6) });
    assert.equal(await c.clear(9), "winner");
    await c.settle(9);
    await c.void(9);

    assert.deepEqual(calls.map(([name, args]) => [name, args.round_id?.toString?.() ?? args.round_id]), [
      ["open_reveal", "9"],
      ["reveal", "9"],
      ["clear", "9"],
      ["settle", "9"],
      ["void", "9"],
    ]);
  });

  it("read-only views unwrap results and getSeal returns undefined when empty", async () => {
    const c = newClient();
    c.contract.get_round = async () =>
      ({ result: { unwrap: () => ({ id: 9 }) } }) as any;
    c.contract.get_bid_state = async () =>
      ({ result: { unwrap: () => ({ enrolled: true }) } }) as any;
    c.contract.get_bidders = async () =>
      ({ result: { unwrap: () => ["A", "B"] } }) as any;
    c.contract.get_seal = async () => ({ result: undefined } as any);
    c.contract.get_config = async () =>
      ({ result: { unwrap: () => ({ maxEscrow: 5n }) } }) as any;

    const r = await c.getRound(9);
    assert.deepEqual(r, { id: 9 });
    const bs = await c.getBidState(1, "X");
    assert.deepEqual(bs, { enrolled: true });
    const bidders = await c.getBidders(1);
    assert.deepEqual(bidders, ["A", "B"]);
    const seal = await c.getSeal(1, "X");
    assert.equal(seal, undefined);
    const cfg = await c.getConfig();
    assert.deepEqual(cfg, { maxEscrow: 5n });
  });

  it("direct RPC signAndSend errors are wrapped in SubRosaSubmitError", async () => {
    const c = newClient({ publicKey: addr(1) });
    c.contract.commit = async () =>
      ({
        signAndSend: async () => {
          throw new Error("boom");
        },
      }) as any;
    await assert.rejects(
      () =>
        c.commit({
          roundId: 1,
          sealed: {
            commitment: u8(32, 1),
            ciphertext: u8(1, 2),
            auditorBlob: u8(0, 0),
          } as any,
          escrow: 1n,
          bidder: addr(2),
        }),
      SubRosaSubmitError,
    );
  });

  it("injected submitter: success, missing returnValue, terminal failure, and timeout", async () => {
    const realGetTx = rpc.Server.prototype.getTransaction;
    try {
      rpc.Server.prototype.getTransaction = async function (hash: string) {
        if (hash === "ok") {
          return {
            status: rpc.Api.GetTransactionStatus.SUCCESS,
            returnValue: "RV-OK",
          };
        }
        if (hash === "missing") {
          return { status: rpc.Api.GetTransactionStatus.SUCCESS } as any;
        }
        if (hash === "failed") {
          return { status: "FAILED" } as any;
        }
        return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as any;
      };

      const submitter = {
        name: "mock-submitter",
        async submitSignedTransaction() {
          return { hash: "ok" };
        },
      } as any;

      const c = newClient({
        publicKey: addr(7),
        submitter,
        _sleep: async (_ms: number) => {},
      });

      const tx = {
        signed: undefined as any,
        sign: async function () {
          this.signed = { toXDR: () => "x" };
        },
        options: {
          parseResultXdr: (v: string) => ({
            unwrap: () => (v === "RV-OK" ? 123n : 0n),
          }),
        },
      } as any;

      c.contract.create_round = async () => tx;
      const res = await c.createRound({
        itemRef: u8(32, 1),
        revealRound: 1,
        commitDeadline: 1,
        revealDeadline: 2,
        auditorPubkey: u8(96, 2),
      });
      assert.equal(res, 123n);

      (submitter as any).submitSignedTransaction = async () => ({
        hash: "missing",
      });
      c.contract.create_round = async () =>
        ({ sign: tx.sign, signed: tx.signed, options: tx.options }) as any;
      await assert.rejects(
        () =>
          c.createRound({
            itemRef: u8(32, 1),
            revealRound: 1,
            commitDeadline: 1,
            revealDeadline: 2,
            auditorPubkey: u8(96, 2),
          }),
        SubRosaMissingReturnValueError,
      );

      (submitter as any).submitSignedTransaction = async () => ({
        hash: "failed",
      });
      c.contract.create_round = async () => tx;
      await assert.rejects(
        () =>
          c.createRound({
            itemRef: u8(32, 1),
            revealRound: 1,
            commitDeadline: 1,
            revealDeadline: 2,
            auditorPubkey: u8(96, 2),
          }),
        SubRosaTransactionError,
      );

      // timeout: the injected clock should drive the polling loop without real wall-clock waits
      (submitter as any).submitSignedTransaction = async () => ({ hash: "notfound" });
      c.contract.create_round = async () => tx;
      let now = 0;
      (Date as any).now = () => {
        throw new Error("Date.now should not be used when a deterministic clock is injected");
      };
      const c2 = newClient({ publicKey: addr(8), submitter, confirmTimeout: 1_000, pollInterval: 100, _sleep: async (ms: number) => { now += ms; }, _now: () => now } as any);
      c2.contract.create_round = async () => tx;
      await assert.rejects(() => c2.createRound({ itemRef: u8(32, 1), revealRound: 1, commitDeadline: 1, revealDeadline: 2, auditorPubkey: u8(96, 2) }), SubRosaTimeoutError);
      assert.equal(now, 1_000);
    } finally {
      rpc.Server.prototype.getTransaction = realGetTx;
      (Date as any).now = Date.now;
    }
  });
});
