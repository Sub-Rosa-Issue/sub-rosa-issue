// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryQuoteRateLimiter,
  type QuoteRateLimiter,
} from "./quote-rate-limit.js";

const OPTIONS = { limit: 2, windowMs: 1_000, maxKeys: 2 };

test("allows quotes inside the window and refuses the next one", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.deepEqual(limiter.take("client-a", 0), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.take("client-a", 100), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.take("client-a", 200), { allowed: false, retryAfterMs: 800 });
});

test("a refused call does not mint an extra quote slot", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  limiter.take("client-a", 2);
  assert.equal(limiter.take("client-a", 3).allowed, false);
});

test("another key has its own window", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  assert.equal(limiter.take("client-b", 2).allowed, true);
});

test("advancing the clock opens a new window", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  limiter.take("client-a", 0);
  limiter.take("client-a", 1);
  assert.equal(limiter.take("client-a", 1_000).allowed, true);
});

test("the key map is bounded and fail-closed for a new key", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.equal(limiter.take("one", 0).allowed, true);
  assert.equal(limiter.take("two", 0).allowed, true);
  assert.deepEqual(limiter.take("three", 0), { allowed: false, retryAfterMs: 1_000 });
});

test("a non-finite clock refuses the quote", () => {
  const limiter = createMemoryQuoteRateLimiter(OPTIONS);
  assert.equal(limiter.take("client-a", Number.NaN).allowed, false);
});

test("a production adapter can replace the memory limiter", () => {
  const production: QuoteRateLimiter = {
    take() {
      return { allowed: false, retryAfterMs: 5_000 };
    },
  };
  assert.deepEqual(production.take("client-a", 10), {
    allowed: false,
    retryAfterMs: 5_000,
  });
});
