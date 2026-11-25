import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KeeperStatusClient,
  StatusApiError,
  StatusJsonParseError,
  type StatusClientOptions,
} from "./status-client.js";
import { createFakeTime } from "@sub-rosa/time";
import type { KeeperStatusResponse } from "./status.js";

const SAMPLE_STATUS: KeeperStatusResponse = {
  contractId: "C123",
  network: "testnet",
  uptimeSeconds: 42,
  rounds: [],
  health: {
    rpc: "ok",
    drand: "ok",
    checkedAt: "2026-01-01T00:00:00.000Z",
  },
  now: "2026-01-01T00:00:00.000Z",
};

function mockFetch(body: string, status = 200): typeof fetch {
  return async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("KeeperStatusClient successful JSON parsing", () => {
  it("aborts a request after the configured timeout", async () => {
    const client = new KeeperStatusClient({ baseURL: "http://keeper.test", timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))) });
    await assert.rejects(() => client.getStatus(), /timed out/i);
  });
  it("returns valid successful JSON unchanged", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch(JSON.stringify(SAMPLE_STATUS)),
    });
    const status = await client.getStatus();
    assert.deepEqual(status, SAMPLE_STATUS);
  });

  it("rejects empty successful JSON bodies", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("   "),
    });
    await assert.rejects(
      () => client.getStatus(),
      (error: unknown) => {
        assert.ok(error instanceof StatusJsonParseError);
        assert.equal(error.status, 200);
        return true;
      },
    );
  });

  it("rejects malformed successful JSON bodies", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("{not-json"),
    });
    await assert.rejects(
      () => client.getStatus(),
      (error: unknown) => {
        assert.ok(error instanceof StatusJsonParseError);
        assert.match(error.message, /invalid JSON/i);
        return true;
      },
    );
  });
});

describe("KeeperStatusClient non-success responses", () => {
  it("preserves typed StatusApiError for non-2xx JSON errors", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch(JSON.stringify({ error: "round not found" }), 404),
    });
    await assert.rejects(
      () => client.getRound(7),
      (error: unknown) => {
        assert.ok(error instanceof StatusApiError);
        assert.equal(error.status, 404);
        assert.equal(error.data.error, "round not found");
        return true;
      },
    );
  });

  it("preserves StatusApiError when non-2xx bodies are malformed JSON", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("not-json", 503),
    });
    await assert.rejects(
      () => client.getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof StatusApiError);
        assert.equal(error.status, 503);
        assert.equal(error.data.error, "invalid JSON body");
        return true;
      },
    );
  });
});

describe("KeeperStatusClient readiness", () => {
  const ROUND = {
    roundId: "7", status: "Open", phase: "awaiting-drand", nextAction: "wait", commitDeadline: 1,
    revealDeadline: 2, revealRound: 3, revealReady: false, commitClosed: false, revealWindowOpen: false,
    voidableAfter: null, bidderCount: 0, revealedCount: 0, winner: null, winningValue: null,
    clearingRule: "HighestBid", settlement: "none", lastKeeperAction: null, lastError: null, retryCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as const;
  const LIVE: KeeperStatusResponse = { ...SAMPLE_STATUS, rounds: [ROUND] };

  /** Fetch that answers the first call and hangs (ignoring abort) afterwards. */
  function fakeKeeper(bodies: Array<KeeperStatusResponse | "hang">): typeof fetch {
    let call = 0;
    return async () => {
      const next = bodies[Math.min(call++, bodies.length - 1)];
      if (next === "hang") return new Promise<Response>(() => {});
      return new Response(JSON.stringify(next), { status: 200 });
    };
  }

  function client(bodies: Array<KeeperStatusResponse | "hang">, extra: Partial<StatusClientOptions> = {}) {
    const time = createFakeTime(1_700_000_000_000);
    const c = new KeeperStatusClient({
      baseURL: "http://keeper.test", timeoutMs: 5_000, scheduler: time.scheduler,
      contractId: "C123", roundId: 7n, fetchImpl: fakeKeeper(bodies), ...extra,
    });
    return { c, time };
  }

  it("a response inside the deadline returns the live snapshot", async () => {
    const { c, time } = client([LIVE]);
    const verdict = await c.readiness();
    assert.deepEqual(verdict, { ready: true, snapshot: LIVE });
    assert.deepEqual(c.lastSnapshot, LIVE);
    assert.equal(time.scheduler.pendingCount(), 0);
  });

  it("a timeout returns not-ready and drops the previous snapshot", async () => {
    const { c, time } = client([LIVE, "hang"]);
    assert.equal((await c.readiness()).ready, true);
    const pending = c.readiness();
    await new Promise((r) => setImmediate(r));
    time.scheduler.advance(4_999);
    await new Promise((r) => setImmediate(r));
    time.scheduler.advance(1);
    const verdict = await pending;
    assert.equal(verdict.ready, false);
    assert.equal(verdict.ready === false && verdict.reason, "timeout");
    assert.ok(!("snapshot" in verdict));
    assert.equal(c.lastSnapshot, null);
  });

  it("a mismatched contract id returns not-ready", async () => {
    const { c } = client([LIVE, { ...LIVE, contractId: "COTHER" }]);
    await c.readiness();
    const verdict = await c.readiness();
    assert.equal(verdict.ready === false && verdict.reason, "contract_mismatch");
    assert.equal(c.lastSnapshot, null);
  });

  it("a body without the configured round returns not-ready", async () => {
    const { c } = client([{ ...LIVE, rounds: [{ ...ROUND, roundId: "8" }] }]);
    const verdict = await c.readiness();
    assert.equal(verdict.ready === false && verdict.reason, "round_mismatch");
  });

  it("errors never include keeper URL userinfo", async () => {
    const { c } = client([LIVE], {
      baseURL: "http://operator:hunter2@keeper.test",
      fetchImpl: async (url) => { throw new TypeError(`Request cannot be constructed from a URL that includes credentials: ${String(url)}`); },
    });
    const verdict = await c.readiness();
    assert.equal(verdict.ready === false && verdict.reason, "unavailable");
    assert.ok(verdict.ready === false && !verdict.error.includes("hunter2") && !verdict.error.includes("operator:"));
  });
});
