import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyError,
  calculateBackoff,
  withRetry,
  defaultRetryPolicy,
  retryPolicyFromEnv,
} from "./retry.js";

test("classifyError identifies transient timeout errors", () => {
  const timeoutCases = [
    new Error("Timeout waiting for response"),
    new Error("ETIMEDOUT"),
    new Error("Connection timed out"),
    { message: "Request timeout" },
    { message: "socket timeout" },
  ];

  for (const err of timeoutCases) {
    const result = classifyError(err);
    assert.equal(result.isTransient, true, `Should classify ${JSON.stringify(err)} as transient`);
    assert.match(result.reason, /timeout/i);
  }
});

test("classifyError identifies transient connection errors", () => {
  const connCases = [
    new Error("ECONNREFUSED"),
    new Error("ECONNRESET"),
    new Error("ENOTFOUND"),
    new Error("connection refused"),
    new Error("socket hang up"),
    { message: "ENETUNREACH" },
  ];

  for (const err of connCases) {
    const result = classifyError(err);
    assert.equal(result.isTransient, true, `Should classify ${JSON.stringify(err)} as transient`);
    assert.match(result.reason, /connection|socket/i);
  }
});

test("classifyError identifies transient rate limit (429)", () => {
  const rateLimitCases = [
    new Error("429 Too Many Requests"),
    new Error("rate limited"),
    { message: "too many requests" },
    { message: "HTTP 429" },
  ];

  for (const err of rateLimitCases) {
    const result = classifyError(err);
    assert.equal(result.isTransient, true, `Should classify ${JSON.stringify(err)} as transient`);
    assert.match(result.reason, /429|rate/i);
  }
});

test("classifyError identifies transient 5xx errors except 501", () => {
  const cases5xx = [
    { err: new Error("HTTP 500"), expectTransient: true },
    { err: new Error("502 Bad Gateway"), expectTransient: true },
    { err: new Error("503 Service Unavailable"), expectTransient: true },
    { err: new Error("HTTP 501 Not Implemented"), expectTransient: false },
  ];

  for (const { err, expectTransient } of cases5xx) {
    const result = classifyError(err);
    assert.equal(
      result.isTransient,
      expectTransient,
      `Should classify ${JSON.stringify(err)} as ${expectTransient ? "transient" : "terminal"}`,
    );
  }
});

test("classifyError identifies terminal contract errors", () => {
  const contractCases = [
    new Error("HostError: ContractError"),
    { message: "InvocationError" },
    { message: "ValidationError: invalid input" },
    { message: "HostError: ... InvalidDrandSignature" },
  ];

  for (const err of contractCases) {
    const result = classifyError(err);
    assert.equal(result.isTransient, false, `Should classify ${JSON.stringify(err)} as terminal`);
  }
});

test("classifyError identifies terminal 4xx errors except 429", () => {
  const cases4xx = [
    { err: new Error("401 Unauthorized"), expect: false },
    { err: new Error("403 Forbidden"), expect: false },
    { err: new Error("404 Not Found"), expect: false },
    { err: new Error("429 Too Many Requests"), expect: true }, // 429 is special
  ];

  for (const { err, expect } of cases4xx) {
    const result = classifyError(err);
    assert.equal(result.isTransient, expect, `Should classify ${JSON.stringify(err)} correctly`);
  }
});

test("calculateBackoff applies exponential backoff", () => {
  const policy = {
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitterFraction: 0,
  };

  // attempt 1: 100 * 2^0 = 100
  assert.equal(calculateBackoff(1, policy, () => 0), 100);
  // attempt 2: 100 * 2^1 = 200
  assert.equal(calculateBackoff(2, policy, () => 0), 200);
  // attempt 3: 100 * 2^2 = 400
  assert.equal(calculateBackoff(3, policy, () => 0), 400);
  // attempt 4: 100 * 2^3 = 800
  assert.equal(calculateBackoff(4, policy, () => 0), 800);
  // attempt 5: 100 * 2^4 = 1600
  assert.equal(calculateBackoff(5, policy, () => 0), 1600);
});

test("calculateBackoff caps at maxDelayMs", () => {
  const policy = {
    maxAttempts: 10,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    jitterFraction: 0,
  };

  // attempt 6: 100 * 2^5 = 3200, capped at 1000
  assert.equal(calculateBackoff(6, policy, () => 0), 1000);
  // attempt 7: 100 * 2^6 = 6400, capped at 1000
  assert.equal(calculateBackoff(7, policy, () => 0), 1000);
});

test("calculateBackoff applies jitter", () => {
  const policy = {
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitterFraction: 0.5, // 50% jitter
  };

  // With jitter=0.5 and random=0.5: delay = 100 * (1 + 0.5*0.5) = 100 * 1.25 = 125
  assert.equal(calculateBackoff(1, policy, () => 0.5), 125);

  // With jitter=0.5 and random=1: delay = 100 * (1 + 0.5*1) = 100 * 1.5 = 150
  assert.equal(calculateBackoff(1, policy, () => 1), 150);

  // With jitter=0.5 and random=0: delay = 100 * (1 + 0.5*0) = 100
  assert.equal(calculateBackoff(1, policy, () => 0), 100);
});

test("withRetry succeeds on first attempt", async () => {
  const policy = defaultRetryPolicy();
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts++;
      return "success";
    },
    {
      operation: "test",
      policy,
      sleep: async () => {}, // no actual sleep
    },
  );

  assert.equal(result, "success");
  assert.equal(attempts, 1);
});

test("withRetry retries on transient error and succeeds", async () => {
  const policy = defaultRetryPolicy();
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("Timeout waiting");
      return "success";
    },
    {
      operation: "test",
      policy,
      sleep: async () => {}, // no actual sleep
      logger: () => {}, // suppress logs
    },
  );

  assert.equal(result, "success");
  assert.equal(attempts, 3);
});

test("withRetry throws on terminal error without retry", async () => {
  const policy = defaultRetryPolicy();
  let attempts = 0;

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts++;
          throw new Error("HostError: InvalidInput");
        },
        {
          operation: "test",
          policy,
          sleep: async () => {}, // no actual sleep
          logger: () => {}, // suppress logs
        },
      ),
    /InvalidInput/,
  );

  assert.equal(attempts, 1, "Should not retry terminal errors");
});

test("withRetry exhausts retries on persistent transient error", async () => {
  const policy = {
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    jitterFraction: 0,
  };
  let attempts = 0;

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts++;
          throw new Error("Connection refused");
        },
        {
          operation: "test",
          policy,
          sleep: async () => {}, // no actual sleep
          logger: () => {}, // suppress logs
        },
      ),
    /Connection refused/,
  );

  assert.equal(attempts, 3, "Should exhaust maxAttempts");
});

test("withRetry injects time and never actually sleeps", async () => {
  const policy = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    jitterFraction: 0,
  };
  const logs: string[] = [];
  let sleepCalls = 0;
  const sleepDurations: number[] = [];

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          throw new Error("Timeout");
        },
        {
          operation: "fetch",
          policy,
          sleep: async (ms: number) => {
            sleepCalls++;
            sleepDurations.push(ms);
            // Don't actually sleep; just record that sleep would have been called
          },
          logger: (msg: string) => logs.push(msg),
        },
      ),
    /Timeout/,
  );

  // Verify that sleep was called (since we're retrying)
  assert.equal(sleepCalls, 2, "Should call sleep between retry attempts");
  // Verify the delays are exponential backoff
  assert.deepEqual(sleepDurations, [100, 200], "Should use exponential backoff");
  // Verify logs mention the delays
  assert(
    logs.some((l) => l.includes("100ms")),
    "Should log the intended delay",
  );
});

test("withRetry respects maxAttempts environment variable", () => {
  const originalEnv = process.env.RETRY_MAX_ATTEMPTS;
  try {
    process.env.RETRY_MAX_ATTEMPTS = "10";
    const policy = retryPolicyFromEnv();
    assert.equal(policy.maxAttempts, 10);
  } finally {
    process.env.RETRY_MAX_ATTEMPTS = originalEnv;
  }
});

test("withRetry respects baseDelayMs environment variable", () => {
  const originalEnv = process.env.RETRY_BASE_DELAY_MS;
  try {
    process.env.RETRY_BASE_DELAY_MS = "200";
    const policy = retryPolicyFromEnv();
    assert.equal(policy.baseDelayMs, 200);
  } finally {
    process.env.RETRY_BASE_DELAY_MS = originalEnv;
  }
});

test("withRetry respects maxDelayMs environment variable", () => {
  const originalEnv = process.env.RETRY_MAX_DELAY_MS;
  try {
    process.env.RETRY_MAX_DELAY_MS = "10000";
    const policy = retryPolicyFromEnv();
    assert.equal(policy.maxDelayMs, 10000);
  } finally {
    process.env.RETRY_MAX_DELAY_MS = originalEnv;
  }
});

test("withRetry respects jitterFraction environment variable", () => {
  const originalEnv = process.env.RETRY_JITTER_FRACTION;
  try {
    process.env.RETRY_JITTER_FRACTION = "0.5";
    const policy = retryPolicyFromEnv();
    assert.equal(policy.jitterFraction, 0.5);
  } finally {
    process.env.RETRY_JITTER_FRACTION = originalEnv;
  }
});

test("retryPolicyFromEnv preserves zero jitterFraction", () => {
  const originalEnv = process.env.RETRY_JITTER_FRACTION;
  try {
    process.env.RETRY_JITTER_FRACTION = "0";
    const policy = retryPolicyFromEnv();
    assert.equal(policy.jitterFraction, 0);
  } finally {
    process.env.RETRY_JITTER_FRACTION = originalEnv;
  }
});

test("classifyError identifies transient errors from numeric status properties", () => {
  const result = classifyError({ status: 500, message: "server failure" });
  assert.equal(result.isTransient, true);
  assert.match(result.reason, /retryable 5xx/i);
});

test("defaultRetryPolicy has sensible defaults", () => {
  const policy = defaultRetryPolicy();
  assert.equal(policy.maxAttempts, 5);
  assert.equal(policy.baseDelayMs, 100);
  assert.equal(policy.maxDelayMs, 5000);
  assert.equal(policy.jitterFraction, 0.1);
});
