import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  createFakeTime,
  fetchWithTimeout,
  resolveRequestTimeoutMs,
} from "./index.js";

/** A fetch that never answers and rejects when its signal aborts. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

/**
 * A fetch whose response headers arrive immediately but whose body never
 * finishes: it emits `prefix` (if any) and then stalls, erroring only if the
 * request signal aborts.
 */
function stalledBodyFetch(prefix = ""): typeof fetch {
  return async (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (prefix) controller.enqueue(new TextEncoder().encode(prefix));
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      },
    });
    return new Response(body, { status: 200 });
  };
}

describe("shared request timeout", () => {
  it("defaults to a single 10s bound", () => {
    assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 10_000);
    assert.equal(resolveRequestTimeoutMs(), 10_000);
    assert.equal(resolveRequestTimeoutMs(2_500), 2_500);
  });

  it("rejects values that would disable or distort the bound", () => {
    for (const bad of [0, -1, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001]) {
      assert.throws(() => resolveRequestTimeoutMs(bad), RangeError, String(bad));
    }
  });

  it("aborts a hung request with RequestTimeoutError after the default timeout", async () => {
    const { scheduler } = createFakeTime();
    const pending = fetchWithTimeout("https://example.invalid/x", {}, { fetchImpl: hangingFetch, scheduler });
    const outcome = pending.then(
      () => "resolved",
      (e: unknown) => e,
    );

    scheduler.advance(DEFAULT_REQUEST_TIMEOUT_MS - 1);
    await Promise.resolve();
    assert.equal(scheduler.pendingCount(), 1, "still waiting just before the deadline");

    scheduler.advance(1);
    const error = await outcome;
    assert.ok(error instanceof RequestTimeoutError);
    assert.equal(error.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    assert.match(error.message, /timed out after 10000ms/);
    assert.doesNotMatch(error.message, /example\.invalid/, "must not leak the URL");
  });

  it("honours a per-call timeout override", async () => {
    const { scheduler } = createFakeTime();
    const outcome = fetchWithTimeout("https://x.invalid", {}, { fetchImpl: hangingFetch, scheduler, timeoutMs: 250 }).then(
      () => "resolved",
      (e: unknown) => e,
    );
    scheduler.advance(250);
    const error = await outcome;
    assert.ok(error instanceof RequestTimeoutError);
    assert.equal(error.timeoutMs, 250);
  });

  it("clears the timer once the response body has been read", async () => {
    const { scheduler } = createFakeTime();
    const ok: typeof fetch = async () => new Response('{"ok":true}', { status: 200 });
    const res = await fetchWithTimeout("https://x.invalid", {}, { fetchImpl: ok, scheduler });
    assert.equal(res.status, 200);
    assert.equal(scheduler.pendingCount(), 1, "the deadline still covers the unread body");
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("clears the timer immediately for a response with no body", async () => {
    const { scheduler } = createFakeTime();
    const empty: typeof fetch = async () => new Response(null, { status: 204 });
    const res = await fetchWithTimeout("https://x.invalid", {}, { fetchImpl: empty, scheduler });
    assert.equal(res.status, 204);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("keeps status, headers and url on the returned response", async () => {
    const { scheduler } = createFakeTime();
    const upstream = new Response("hi", { status: 202, statusText: "Accepted", headers: { "x-test": "1" } });
    Object.defineProperty(upstream, "url", { value: "https://x.invalid/final" });
    const res = await fetchWithTimeout("https://x.invalid", {}, { fetchImpl: async () => upstream, scheduler });
    assert.equal(res.status, 202);
    assert.equal(res.statusText, "Accepted");
    assert.equal(res.headers.get("x-test"), "1");
    assert.equal(res.url, "https://x.invalid/final");
    assert.equal(await res.text(), "hi");
  });

  it("rejects a stalled body with RequestTimeoutError after the headers arrived", async () => {
    const { scheduler } = createFakeTime();
    const outcome = fetchWithTimeout("https://x.invalid", {}, { fetchImpl: stalledBodyFetch(), scheduler, timeoutMs: 500 }).then(
      async (res) => {
        assert.equal(res.status, 200, "headers arrive before the stall");
        return res.json().then(
          () => "parsed",
          (e: unknown) => e,
        );
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    scheduler.advance(500);
    const error = await outcome;
    assert.ok(error instanceof RequestTimeoutError, String(error));
    assert.equal(error.timeoutMs, 500);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("times out a body that stalls part-way through", async () => {
    const { scheduler } = createFakeTime();
    const res = await fetchWithTimeout("https://x.invalid", {}, {
      fetchImpl: stalledBodyFetch('{"partial":'),
      scheduler,
      timeoutMs: 500,
    });
    const outcome = res.text().then(
      () => "read",
      (e: unknown) => e,
    );
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.advance(500);
    assert.ok((await outcome) instanceof RequestTimeoutError);
  });

  it("preserves a caller abort that happens while the body is being read", async () => {
    const { scheduler } = createFakeTime();
    const caller = new AbortController();
    const reason = new Error("caller cancelled mid-body");
    const res = await fetchWithTimeout("https://x.invalid", { signal: caller.signal }, {
      fetchImpl: stalledBodyFetch(),
      scheduler,
    });
    const outcome = res.json().then(
      () => "parsed",
      (e: unknown) => e,
    );
    await new Promise((resolve) => setImmediate(resolve));
    caller.abort(reason);
    assert.equal(await outcome, reason);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("releases the timer when the body is cancelled", async () => {
    const { scheduler } = createFakeTime();
    const res = await fetchWithTimeout("https://x.invalid", {}, { fetchImpl: stalledBodyFetch(), scheduler });
    assert.equal(scheduler.pendingCount(), 1);
    await res.body?.cancel();
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("clears the timer and rethrows a non-timeout failure unchanged", async () => {
    const { scheduler } = createFakeTime();
    const boom = new Error("connect refused");
    const failing: typeof fetch = async () => {
      throw boom;
    };
    await assert.rejects(fetchWithTimeout("https://x.invalid", {}, { fetchImpl: failing, scheduler }), (e) => e === boom);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("preserves a caller abort instead of reporting a timeout", async () => {
    const { scheduler } = createFakeTime();
    const caller = new AbortController();
    const reason = new Error("caller cancelled");
    const outcome = fetchWithTimeout("https://x.invalid", { signal: caller.signal }, { fetchImpl: hangingFetch, scheduler }).then(
      () => "resolved",
      (e: unknown) => e,
    );
    caller.abort(reason);
    assert.equal(await outcome, reason);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const { scheduler } = createFakeTime();
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(
      fetchWithTimeout("https://x.invalid", { signal: caller.signal }, { fetchImpl: hangingFetch, scheduler }),
    );
    assert.equal(scheduler.pendingCount(), 0);
  });
});
