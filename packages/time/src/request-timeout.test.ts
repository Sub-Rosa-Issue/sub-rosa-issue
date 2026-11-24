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

  it("clears the timer when the request succeeds", async () => {
    const { scheduler } = createFakeTime();
    const ok: typeof fetch = async () => new Response("{}", { status: 200 });
    const res = await fetchWithTimeout("https://x.invalid", {}, { fetchImpl: ok, scheduler });
    assert.equal(res.status, 200);
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
