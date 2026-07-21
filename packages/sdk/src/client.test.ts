import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpc, StrKey } from "@stellar/stellar-sdk";

import { SubRosaClient } from "./client.js";
import {
  SubRosaClientConfigError,
  SubRosaSubmitError,
} from "./errors.js";
import type {
  SubmitSignedTransactionParams,
  TransactionSubmitter,
} from "./submitter.js";

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: StrKey.encodeContract(Buffer.alloc(32)),
  _server: {
    getNetwork: async () => ({
      passphrase: "Test SDF Network ; September 2015",
      protocolVersion: "23",
    }),
    getLedgerEntries: async () => ({
      entries: [{}],
      latestLedger: 123,
    }),
  } as unknown as rpc.Server,
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

  it("rejects a mismatched RPC before building a contract call", async () => {
    let contractCalls = 0;
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      _server: {
        getNetwork: async () => ({
          passphrase: "Public Global Stellar Network ; September 2015",
          protocolVersion: "23",
        }),
        getLedgerEntries: async () => ({ entries: [], latestLedger: 123 }),
      } as unknown as rpc.Server,
    });
    Object.defineProperty(client.contract, "get_round", {
      configurable: true,
      value: async () => {
        contractCalls += 1;
        throw new Error("must not be reached");
      },
    });

    await assert.rejects(client.getRound(1), /same deployment/);
    assert.equal(contractCalls, 0);
  });

  it("caches successful first-use validation", async () => {
    let networkLookups = 0;
    let contractLookups = 0;
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      _server: {
        getNetwork: async () => {
          networkLookups += 1;
          return {
            passphrase: BASE_CONFIG.networkPassphrase,
            protocolVersion: "23",
          };
        },
        getLedgerEntries: async () => {
          contractLookups += 1;
          return { entries: [{}], latestLedger: 123 };
        },
      } as unknown as rpc.Server,
    });
    Object.defineProperty(client.contract, "get_round", {
      configurable: true,
      value: async () => ({ result: { unwrap: () => ({}) } }),
    });

    await client.getRound(1);
    await client.getRound(2);

    assert.equal(networkLookups, 1);
    assert.equal(contractLookups, 1);
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
          ciphertext: new Uint8Array([0x61, 0x67, 0x65]), // non-empty
          auditorBlob: new Uint8Array(1), // non-empty
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
