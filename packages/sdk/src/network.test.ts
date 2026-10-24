import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StrKey } from "@stellar/stellar-sdk";
import { createFakeTime } from "@sub-rosa/time";
import {
  SubRosaClientConfigError,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
} from "./errors.js";
import { SubRosaClient } from "./client.js";
import { KeeperStatusClient } from "./status-client.js";
import {
  assertRpcTimeoutMs,
  createBoundedFetch,
  DEFAULT_RPC_TIMEOUT_MS,
  describeNetworkPassphraseMismatch,
  networkDisplayName,
  networkPassphrasesMatch,
  SubRosaNetworkPassphraseMismatchError,
  SubRosaRpcRequestTimeoutError,
  validateContractNetwork,
  validatePasskeySession,
  withBoundedTimeout,
  type NetworkValidationServer,
} from "./network.js";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));
const RPC_URL = "https://rpc.example.test";

function server(
  passphrase: string,
  contractExists = true,
): NetworkValidationServer {
  return {
    getNetwork: async () => ({
      passphrase,
      protocolVersion: "23",
    }),
    getLedgerEntries: async () => ({
      entries: contractExists ? [{} as never] : [],
      latestLedger: 123,
    }),
  } as NetworkValidationServer;
}

const config = (networkPassphrase: string) => ({
  networkPassphrase,
  contractId: CONTRACT_ID,
  rpcUrl: RPC_URL,
});

describe("validateContractNetwork", () => {
  it("accepts matched testnet and public-network configurations", async () => {
    await assert.doesNotReject(
      validateContractNetwork(server(TESTNET), config(TESTNET)),
    );
    await assert.doesNotReject(
      validateContractNetwork(server(PUBLIC), config(PUBLIC)),
    );
  });

  it("rejects a testnet passphrase against a public-network RPC", async () => {
    await assert.rejects(
      validateContractNetwork(server(PUBLIC), config(TESTNET)),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.equal(error.reason, "passphrase");
        assert.equal(error.configuredPassphrase, TESTNET);
        assert.equal(error.rpcPassphrase, PUBLIC);
        assert.match(error.message, /same deployment/);
        return true;
      },
    );
  });

  it("rejects a public passphrase against a testnet RPC", async () => {
    await assert.rejects(
      validateContractNetwork(server(TESTNET), config(PUBLIC)),
      SubRosaNetworkMismatchError,
    );
  });

  it("rejects a contract that is absent from the configured network", async () => {
    await assert.rejects(
      validateContractNetwork(server(TESTNET, false), config(TESTNET)),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.equal(error.reason, "contract_not_found");
        assert.equal(error.contractId, CONTRACT_ID);
        assert.match(error.message, /contractId and networkPassphrase/);
        return true;
      },
    );
  });

  it("labels known and custom network passphrases", () => {
    assert.equal(networkDisplayName(TESTNET), "Testnet");
    assert.equal(networkDisplayName(PUBLIC), "Public");
    assert.equal(networkDisplayName("Futurenet"), "Futurenet");
    assert.equal(networkDisplayName("Custom Network"), "Custom Network");
    assert.equal(networkDisplayName("   "), "an unknown network");
  });

  it("matches passphrases after trimming", () => {
    assert.equal(networkPassphrasesMatch(TESTNET, ` ${TESTNET} `), true);
    assert.equal(networkPassphrasesMatch(TESTNET, PUBLIC), false);
  });

  it("names both networks on a passphrase mismatch without exposing a secret", () => {
    const error = new SubRosaNetworkPassphraseMismatchError(PUBLIC, TESTNET);
    assert.equal(error.chainNetwork, "Public");
    assert.equal(error.sdkNetwork, "Testnet");
    assert.equal(error.message, describeNetworkPassphraseMismatch(PUBLIC, TESTNET));
    assert.match(error.message, /Public/);
    assert.match(error.message, /Testnet/);
    assert.doesNotMatch(error.message, /\bS[A-Z2-7]{55}\b/);
    assert.doesNotMatch(error.message, /AAAA/);
  });

  it("does not look up the contract after a passphrase mismatch", async () => {
    let ledgerLookups = 0;
    const mock = server(PUBLIC);
    mock.getLedgerEntries = async () => {
      ledgerLookups += 1;
      return { entries: [], latestLedger: 123 };
    };

    await assert.rejects(
      validateContractNetwork(mock, config(TESTNET)),
      SubRosaNetworkMismatchError,
    );
    assert.equal(ledgerLookups, 0);
  });
});

describe("validatePasskeySession", () => {
  const SESSION_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const SWAPPED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
  const FIXTURE_SEED = "SBGWGH5QWWZ2WKKG24YCQAL35EWB64L35KAGL3E7N7H5K3T4K5K3T4K5";

  it("accepts a matching passkey session and target", () => {
    assert.doesNotThrow(() => {
      validatePasskeySession(
        {
          contractId: CONTRACT_ID,
          networkPassphrase: TESTNET,
          account: SESSION_ACCOUNT,
        },
        {
          contractId: CONTRACT_ID,
          networkPassphrase: TESTNET,
          account: SESSION_ACCOUNT,
        },
      );
    });
  });

  it("rejects a swapped contract id with a typed mismatch error", () => {
    assert.throws(
      () => {
        validatePasskeySession(
          {
            contractId: CONTRACT_ID,
            networkPassphrase: TESTNET,
            account: SESSION_ACCOUNT,
          },
          {
            contractId: SWAPPED_CONTRACT_ID,
            networkPassphrase: TESTNET,
            account: SESSION_ACCOUNT,
          },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "contract_mismatch");
        assert.match((error as Error).message, /contract/);
        return true;
      },
    );
  });

  it("rejects a swapped network passphrase with a typed mismatch error", () => {
    assert.throws(
      () => {
        validatePasskeySession(
          {
            contractId: CONTRACT_ID,
            networkPassphrase: TESTNET,
            account: SESSION_ACCOUNT,
          },
          {
            contractId: CONTRACT_ID,
            networkPassphrase: PUBLIC,
            account: SESSION_ACCOUNT,
          },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "session_mismatch");
        assert.match((error as Error).message, /network/);
        return true;
      },
    );
  });

  it("rejects a swapped account with a typed mismatch error", () => {
    const OTHER_ACCOUNT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";
    assert.throws(
      () => {
        validatePasskeySession(
          {
            contractId: CONTRACT_ID,
            networkPassphrase: TESTNET,
            account: SESSION_ACCOUNT,
          },
          {
            contractId: CONTRACT_ID,
            networkPassphrase: TESTNET,
            account: OTHER_ACCOUNT,
          },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "account_mismatch");
        return true;
      },
    );
  });

  it("ensures the error text does not contain secret seeds", () => {
    try {
      validatePasskeySession(
        {
          contractId: CONTRACT_ID,
          networkPassphrase: TESTNET,
          account: SESSION_ACCOUNT,
        },
        {
          contractId: SWAPPED_CONTRACT_ID,
          networkPassphrase: TESTNET,
          account: SESSION_ACCOUNT,
        },
      );
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes(FIXTURE_SEED));
      assert.ok(!/\bS[A-Z2-7]{55}\b/.test(e.message));
    }
  });
});

describe("DEFAULT_RPC_TIMEOUT_MS and bounded RPC requests", () => {
  it("uses the shared 10_000ms default in SubRosaClient and KeeperStatusClient", () => {
    assert.equal(DEFAULT_RPC_TIMEOUT_MS, 10_000);
    assert.equal(assertRpcTimeoutMs(undefined), 10_000);

    const client = new SubRosaClient({
      rpcUrl: RPC_URL,
      networkPassphrase: TESTNET,
      contractId: CONTRACT_ID,
    });
    assert.equal(client.rpcTimeoutMs, DEFAULT_RPC_TIMEOUT_MS);

    const statusClient = new KeeperStatusClient({
      baseURL: "https://keeper.example.test",
      fetchImpl: (async () => new Response("{}")) as typeof fetch,
    });
    assert.equal(statusClient.timeoutMs, DEFAULT_RPC_TIMEOUT_MS);

    assert.throws(
      () =>
        new SubRosaClient({
          rpcUrl: RPC_URL,
          networkPassphrase: TESTNET,
          contractId: CONTRACT_ID,
          rpcTimeoutMs: 0,
        }),
      SubRosaClientConfigError,
    );
  });

  it("aborts and rejects stalled requests after DEFAULT_RPC_TIMEOUT_MS", async () => {
    const { scheduler } = createFakeTime();
    let aborted = false;

    const boundedFetch = createBoundedFetch({
      scheduler,
      fetchImpl: ((_input, init) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    });

    const pending = boundedFetch("https://rpc.example.test");
    scheduler.advance(DEFAULT_RPC_TIMEOUT_MS - 1);
    assert.equal(aborted, false);

    scheduler.advance(1);
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof SubRosaRpcRequestTimeoutError);
      assert.equal(err.timeoutMs, DEFAULT_RPC_TIMEOUT_MS);
      assert.match(err.message, /timed out after 10000ms/);
      return true;
    });
    assert.equal(aborted, true);
  });

  it("clears the timeout timer once a bounded operation resolves", async () => {
    const { scheduler } = createFakeTime();
    const value = await withBoundedTimeout(async () => "ok", { scheduler });
    assert.equal(value, "ok");
    assert.equal(scheduler.pendingCount(), 0);
  });
});


