// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, rpc, StrKey, xdr } from "@stellar/stellar-sdk";
import { createFakeTime } from "@sub-rosa/time";

import { SubRosaClient } from "./client.js";
import {
  SubRosaClientConfigError,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
  SubRosaSubmitError,
} from "./errors.js";
import type {
  SubmitSignedTransactionParams,
  TransactionSubmitter,
} from "./submitter.js";
import { submissionKey, type SubmissionIdentity, type SubmissionJournal, type SubmissionRecord } from "./submission.js";
import { sealFixture, fixtureBinding } from "./testing/seal-fixture.js";

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

describe("bidder cursor enumeration", () => {
  const fixture = readFileSync(new URL("../../../fixtures/bidder-pagination.txt", import.meta.url), "utf8").trim().split("\n");
  const cursor1 = Buffer.alloc(41, 1);
  const cursor2 = Buffer.alloc(41, 2);
  const pages = () => [
    { data: fixture.slice(0, 3), next_cursor: cursor1, has_more: true, total: 7 },
    { data: fixture.slice(3, 6), next_cursor: cursor2, has_more: true, total: 7 },
    { data: fixture.slice(6), next_cursor: undefined, has_more: false, total: 7 },
  ];
  function mockClient(responses: ReturnType<typeof pages>) {
    const client = new SubRosaClient(BASE_CONFIG);
    const calls: Array<{ round_id: bigint; cursor: Buffer | undefined; limit: number }> = [];
    client.contract.get_bidders_page = (async (args: typeof calls[number]) => {
      calls.push(args);
      const page = responses[calls.length - 1];
      assert.ok(page, "iterator must stop at exhaustion or invalid response");
      return { result: { unwrap: () => page } };
    }) as typeof client.contract.get_bidders_page;
    return { client, calls };
  }
  async function collect(client: SubRosaClient) {
    const out: string[] = [];
    for await (const bidder of client.bidders(1n)) out.push(bidder);
    return out;
  }
  it("reads the shared fixture in three pages exactly once, forwarding opaque tokens", async () => {
    const { client, calls } = mockClient(pages());
    assert.deepEqual(await collect(client), fixture);
    assert.deepEqual(calls.map((c) => c.cursor), [undefined, cursor1, cursor2]);
    assert.ok(calls.every((c) => c.round_id === 1n && c.limit === 100));
  });
  it("stops on a duplicate across pages with a typed error", async () => {
    const responses = pages();
    responses[1].data[1] = fixture[0];
    const { client, calls } = mockClient(responses);
    await assert.rejects(collect(client), (error: unknown) => {
      assert.ok(error instanceof SubRosaPaginationError);
      assert.equal(error.reason, "repeated_bidder");
      assert.equal(error.bidder, fixture[0]);
      assert.equal(error.roundId, 1n);
      return true;
    });
    assert.equal(calls.length, 2);
  });
  it("validates a page before yielding a duplicate within it", async () => {
    const responses = pages();
    responses[0].data = [fixture[0], fixture[0]];
    const { client } = mockClient(responses);
    await assert.rejects(client.bidders(1n).next(), SubRosaPaginationError);
  });
  it("rejects a repeated cursor before fetching another page", async () => {
    const responses = pages();
    responses[1].next_cursor = cursor1;
    const { client, calls } = mockClient(responses);
    await assert.rejects(collect(client), (e: unknown) => e instanceof SubRosaPaginationError && e.reason === "repeated_cursor");
    assert.equal(calls.length, 2);
  });
  for (const [label, mutate] of [
    ["empty continuing page", (p: ReturnType<typeof pages>) => { p[0].data = []; }],
    ["missing continuation", (p: ReturnType<typeof pages>) => { p[0].next_cursor = undefined; }],
    ["truncated terminal page", (p: ReturnType<typeof pages>) => { p[2].data = []; }],
    ["changing total", (p: ReturnType<typeof pages>) => { p[1].total = 8; }],
    ["malformed cursor", (p: ReturnType<typeof pages>) => { p[0].next_cursor = Buffer.alloc(1); }],
    ["terminal continuation", (p: ReturnType<typeof pages>) => { p[2].next_cursor = cursor1; }],
  ] as const) {
    it(`rejects ${label}`, async () => {
      const responses = pages();
      mutate(responses);
      await assert.rejects(collect(mockClient(responses).client), SubRosaPaginationError);
    });
  }
  it("finishes an empty round in one call", async () => {
    const { client, calls } = mockClient([{ data: [], next_cursor: undefined, has_more: false, total: 0 }]);
    assert.deepEqual(await collect(client), []);
    assert.equal(calls.length, 1);
  });
});

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

    // A real seal: commit() runs the sealed-bid gate before it resolves the
    // bidder source, so a placeholder blob would fail on its own terms and
    // this test would stop being about the source check.
    const sealed = await sealFixture();

    await assert.rejects(
      client.commit({
        roundId: 1,
        sealed: {
          commitment: new Uint8Array(32),
          ciphertext: new Uint8Array([0x61, 0x67, 0x65]), // non-empty
          auditorBlob: new Uint8Array(1), // non-empty
          sealRound: 1,
        },
        escrow: 1n,
        binding: fixtureBinding(),
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

describe("durable in-flight submission recovery", () => {
  const identity: SubmissionIdentity = {
    operation: "settle",
    roundId: "9",
    network: BASE_CONFIG.networkPassphrase,
    contractId: BASE_CONFIG.contractId,
  };

  class MemoryJournal implements SubmissionJournal {
    readonly records = new Map<string, SubmissionRecord>();
    async get(key: SubmissionIdentity) {
      const value = this.records.get(submissionKey(key));
      return value ? { ...value } : undefined;
    }
    async put(record: SubmissionRecord) {
      this.records.set(submissionKey(record), { ...record });
    }
  }

  function makeClient(options: {
    journal: MemoryJournal;
    nowMs: number;
    send: () => Promise<unknown>;
    lookup: () => Promise<unknown>;
  }) {
    let builds = 0;
    const fakeTime = createFakeTime(options.nowMs);
    const server = {
      getNetwork: async () => ({ passphrase: BASE_CONFIG.networkPassphrase, protocolVersion: "23" }),
      getLedgerEntries: async () => ({ entries: [{}], latestLedger: 123 }),
      sendTransaction: options.send,
      getTransaction: options.lookup,
    } as unknown as rpc.Server;
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      secretKey: Keypair.random().secret(),
      _server: server,
      submissionJournal: options.journal,
      confirmTimeout: 1_000,
      pollInterval: 100,
      time: { clock: fakeTime.clock, scheduler: fakeTime.scheduler },
    });
    const signed = {
      hash: () => Buffer.alloc(32, 7),
      toXDR: () => "signed-xdr",
      timeBounds: { minTime: "0", maxTime: String(Math.floor(options.nowMs / 1000) + 5) },
    };
    const assembled = {
      signed,
      async sign() {},
      options: { parseResultXdr: () => ({ unwrap: () => undefined }) },
    };
    Object.defineProperty(client.contract, "settle", {
      configurable: true,
      value: async () => {
        builds += 1;
        return assembled;
      },
    });
    return { client, fakeTime, server, buildCount: () => builds };
  }

  it("reconciles a confirmed hash before asking the contract client to build a retry", async () => {
    const nowMs = 4_000_000;
    const journal = new MemoryJournal();
    await journal.put({
      ...identity,
      hash: "0xconfirmed-before-build",
      state: "pending",
      submittedAtMs: nowMs - 1_000,
      expiresAtMs: nowMs + 60_000,
    });
    let sends = 0;
    const { client, buildCount } = makeClient({
      journal,
      nowMs,
      send: async () => {
        sends += 1;
        return { status: "PENDING" };
      },
      lookup: async () => ({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: xdr.ScVal.scvVoid(),
      }),
    });

    await client.settle(9);
    assert.equal(buildCount(), 0);
    assert.equal(sends, 0);
    assert.equal((await journal.get(identity))?.state, "confirmed");
  });

  it("journals before an ambiguous send, then reuses the same hash when it confirms", async () => {
    const nowMs = 1_000_000;
    const journal = new MemoryJournal();
    let sends = 0;
    let found = false;
    const { client } = makeClient({
      journal,
      nowMs,
      send: async () => {
        sends += 1;
        assert.equal((await journal.get(identity))?.state, "pending");
        throw new Error("response lost after RPC accepted transaction");
      },
      lookup: async () => ({
        status: found ? rpc.Api.GetTransactionStatus.SUCCESS : rpc.Api.GetTransactionStatus.NOT_FOUND,
        ...(found ? { returnValue: xdr.ScVal.scvVoid() } : {}),
      }),
    });

    await assert.rejects(client.settle(9), /did not finalize it in time/);
    const pending = await journal.get(identity);
    assert.equal(pending?.state, "pending");
    assert.equal(pending?.operation, "settle");
    assert.equal(pending?.roundId, "9");
    assert.equal(pending?.network, BASE_CONFIG.networkPassphrase);
    assert.equal(sends, 1);

    found = true;
    const recovered = await client.reconcileSubmission({ operation: "settle", roundId: "9" });
    assert.deepEqual(recovered, { hash: pending?.hash, state: "confirmed" });
    assert.equal(sends, 1, "reconciliation polls the old hash and never resubmits it");
  });

  it("replaces an expired hash with one submission, not a retry burst", async () => {
    const nowMs = 2_000_000;
    const journal = new MemoryJournal();
    await journal.put({
      ...identity,
      hash: "expired-hash",
      state: "pending",
      submittedAtMs: nowMs - 10_000,
      expiresAtMs: nowMs - 1,
    });
    let sends = 0;
    let wasSubmitted = false;
    const { client } = makeClient({
      journal,
      nowMs,
      send: async () => {
        sends += 1;
        wasSubmitted = true;
        return { status: "PENDING" };
      },
      lookup: async () => wasSubmitted
        ? { status: rpc.Api.GetTransactionStatus.SUCCESS, returnValue: xdr.ScVal.scvVoid() }
        : { status: rpc.Api.GetTransactionStatus.NOT_FOUND },
    });

    await client.settle(9);
    assert.equal(sends, 1);
    assert.notEqual((await journal.get(identity))?.hash, "expired-hash");
    assert.equal((await journal.get(identity))?.state, "confirmed");
  });

  it("records a definitive network failure and does not treat it as an expiry", async () => {
    const journal = new MemoryJournal();
    let sends = 0;
    const { client } = makeClient({
      journal,
      nowMs: 3_000_000,
      send: async () => {
        sends += 1;
        return { status: "PENDING" };
      },
      lookup: async () => ({ status: rpc.Api.GetTransactionStatus.FAILED }),
    });

    await assert.rejects(client.settle(9), /ended with status FAILED/);
    assert.equal((await journal.get(identity))?.state, "failed");
    const recovered = await client.reconcileSubmission({ operation: "settle", roundId: "9" });
    assert.equal(recovered?.state, "failed");
    assert.equal(sends, 1, "a definitive contract failure is not replaced as if it expired");
  });
});

describe("SubRosaClient passkey session binding", () => {
  const SWAPPED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
  const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
  const FIXTURE_SEED = Keypair.random().secret();

  const VALID_COMMIT_PARAMS = {
    roundId: 1,
    sealed: {
      commitment: new Uint8Array(32),
      ciphertext: new Uint8Array([0x61, 0x67, 0x65]),
      auditorBlob: new Uint8Array(1),
    },
    escrow: 100_000n,
    bidder: PUBLIC_KEY,
  };

  it("exposes account and session properties", () => {
    const session = {
      contractId: BASE_CONFIG.contractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      account: PUBLIC_KEY,
    };
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
      session,
    });
    assert.equal(client.account, PUBLIC_KEY);
    assert.deepEqual(client.session, session);
  });

  it("refuses commit when session contract id does not match client", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    await assert.rejects(
      client.commit({
        ...VALID_COMMIT_PARAMS,
        session: {
          contractId: SWAPPED_CONTRACT_ID,
          networkPassphrase: BASE_CONFIG.networkPassphrase,
          account: PUBLIC_KEY,
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "contract_mismatch");
        return true;
      },
    );
  });

  it("refuses commit when session network passphrase does not match client", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });

    await assert.rejects(
      client.commit({
        ...VALID_COMMIT_PARAMS,
        session: {
          contractId: BASE_CONFIG.contractId,
          networkPassphrase: PUBLIC_PASSPHRASE,
          account: PUBLIC_KEY,
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "session_mismatch");
        return true;
      },
    );
  });

  it("refuses preflightCommit when session does not match", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
      session: {
        contractId: SWAPPED_CONTRACT_ID,
        networkPassphrase: BASE_CONFIG.networkPassphrase,
        account: PUBLIC_KEY,
      },
    });

    await assert.rejects(
      client.preflightCommit(VALID_COMMIT_PARAMS),
      SubRosaNetworkMismatchError,
    );
  });

  it("does not leak secret seed in session mismatch errors", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      secretKey: FIXTURE_SEED,
    });

    try {
      await client.commit({
        ...VALID_COMMIT_PARAMS,
        session: {
          contractId: SWAPPED_CONTRACT_ID,
          networkPassphrase: BASE_CONFIG.networkPassphrase,
        },
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes(FIXTURE_SEED));
      assert.ok(!/\bS[A-Z2-7]{55}\b/.test(e.message));
    }
  });
});
