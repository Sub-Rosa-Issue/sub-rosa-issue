import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  DEFAULT_RPC_TIMEOUT_MS,
  ExternalRpcTimeoutError,
  assertValidRpcTimeoutMs,
  createFakeTime,
  createSystemScheduler,
  fetchWithRpcTimeout,
  withRpcTimeout,
} from "./index.js";

describe("system scheduler sleep", () => {
  it("resolves immediately for non-positive delay", async () => {
    const scheduler = createSystemScheduler();
    await scheduler.sleep(0);
    await scheduler.sleep(-5);
    scheduler.cancelAll();
  });
});

describe("fake scheduler boundary tests", () => {
  it("models reveal deadline polling without real sleeps", async () => {
    const { clock, scheduler } = createFakeTime(1_000_000_000_000);
    const revealDeadline = clock.nowSeconds() + 30;
    let polls = 0;

    async function waitUntilRevealClear(): Promise<void> {
      while (clock.nowSeconds() <= revealDeadline + 3) {
        polls += 1;
        const remain = revealDeadline + 4 - clock.nowSeconds();
        if (remain > 0) {
          await scheduler.sleep(Math.min(5_000, remain * 1_000));
        }
      }
    }

    const pending = waitUntilRevealClear();
    scheduler.advance(40_000);
    await pending;
    assert.ok(polls >= 1);
    assert.ok(clock.nowSeconds() > revealDeadline + 3);
  });
});

describe("shared external RPC timeout", () => {
  it("exports DEFAULT_RPC_TIMEOUT_MS = 10_000 and validates overrides", () => {
    assert.equal(DEFAULT_RPC_TIMEOUT_MS, 10_000);
    assert.equal(assertValidRpcTimeoutMs(undefined), 10_000);
    assert.equal(assertValidRpcTimeoutMs(250), 250);
    assert.throws(() => assertValidRpcTimeoutMs(0), RangeError);
    assert.throws(() => assertValidRpcTimeoutMs(-10), RangeError);
    assert.throws(() => assertValidRpcTimeoutMs(Number.NaN), RangeError);
  });

  it("aborts a hung operation at the configured shorter timeout without leaking URLs or credentials", async () => {
    let signalAborted = false;
    await assert.rejects(
      () =>
        withRpcTimeout(
          (signal) =>
            new Promise((_resolve, _reject) => {
              signal.addEventListener("abort", () => {
                signalAborted = true;
              });
            }),
          {
            timeoutMs: 20,
            operation: "soroban rpc request to https://admin:supersecret@soroban.example.com/rpc?apiKey=secret-token-123",
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ExternalRpcTimeoutError);
        assert.equal(err.code, "RPC_REQUEST_TIMEOUT");
        assert.equal(err.timeoutMs, 20);
        assert.ok(!err.message.includes("supersecret"));
        assert.ok(!err.message.includes("secret-token-123"));
        assert.ok(!err.message.includes("soroban.example.com"));
        return true;
      },
    );
    assert.equal(signalAborted, true);
  });

  it("aborts a real hung HTTP endpoint via fetchWithRpcTimeout", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const server = http.createServer((_req, _res) => {
      // Deliberately never respond to simulate a hung RPC server.
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const url = `http://127.0.0.1:${addr.port}/rpc?token=top-secret-key`;

    try {
      await assert.rejects(
        () =>
          fetchWithRpcTimeout(url, { method: "POST" }, {
            timeoutMs: 25,
            operation: "external rpc fetch",
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExternalRpcTimeoutError);
          assert.equal(err.code, "RPC_REQUEST_TIMEOUT");
          assert.equal(err.timeoutMs, 25);
          assert.ok(!err.message.includes("top-secret-key"));
          assert.ok(!err.message.includes("127.0.0.1"));
          return true;
        },
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("scheduler.test re-exports", () => {
  it("placeholder for module graph", () => {
    assert.ok(createFakeTime);
  });
});
