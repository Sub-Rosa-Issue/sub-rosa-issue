import { test } from "node:test";
import assert from "node:assert/strict";

import { createMetricsCollector } from "./metrics.js";

test("metrics collector starts empty", () => {
  const m = createMetricsCollector();
  const output = m.render();
  // With no counters incremented, render returns empty string (only trailing newline)
  assert.equal(output, "\n");
});

test("incRoundsSeen increments counter", () => {
  const m = createMetricsCollector();
  m.incRoundsSeen();
  m.incRoundsSeen();
  m.incRoundsSeen(3);
  const output = m.render();
  assert.match(output, /^# HELP keeper_rounds_seen_total/m);
  assert.match(output, /^# TYPE keeper_rounds_seen_total counter/m);
  assert.match(output, /^keeper_rounds_seen_total 5$/m);
});

test("incRoundsRevealed increments counter", () => {
  const m = createMetricsCollector();
  m.incRoundsRevealed(2);
  const output = m.render();
  assert.match(output, /^# HELP keeper_rounds_revealed_total/m);
  assert.match(output, /^# TYPE keeper_rounds_revealed_total counter/m);
  assert.match(output, /^keeper_rounds_revealed_total 2$/m);
});

test("incRoundsSettled increments counter", () => {
  const m = createMetricsCollector();
  m.incRoundsSettled(1);
  const output = m.render();
  assert.match(output, /^# HELP keeper_rounds_settled_total/m);
  assert.match(output, /^# TYPE keeper_rounds_settled_total counter/m);
  assert.match(output, /^keeper_rounds_settled_total 1$/m);
});

test("incRoundsFailed increments counter", () => {
  const m = createMetricsCollector();
  m.incRoundsFailed(1);
  const output = m.render();
  assert.match(output, /^# HELP keeper_rounds_failed_total/m);
  assert.match(output, /^# TYPE keeper_rounds_failed_total counter/m);
  assert.match(output, /^keeper_rounds_failed_total 1$/m);
});

test("observeSettleLatency records histogram", () => {
  const m = createMetricsCollector();
  m.observeSettleLatency(0.5);
  m.observeSettleLatency(1.2);
  m.observeSettleLatency(5.0);

  const output = m.render();
  assert.match(output, /^# HELP keeper_settle_duration_seconds/m);
  assert.match(output, /^# TYPE keeper_settle_duration_seconds histogram/m);

  // Bucket checks
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="0\.1"\} 0/m);
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="0\.25"\} 0/m);
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="0\.5"\} 1/m);
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="1"\} 1/m);
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="2\.5"\} 2/m);
  assert.match(output, /keeper_settle_duration_seconds_bucket\{le="5"\} 3/m);
  // Cumulative count at the end should be 3
  assert.match(output, /keeper_settle_duration_seconds_count 3/m);
  // Sum should be 0.5 + 1.2 + 5.0 = 6.7
  assert.match(output, /keeper_settle_duration_seconds_sum 6\.7/m);
});

test("render includes multiple metrics when multiple counters are non-zero", () => {
  const m = createMetricsCollector();
  m.incRoundsSeen(10);
  m.incRoundsRevealed(4);
  m.incRoundsSettled(2);

  const output = m.render();
  // All three counters should be present
  assert.match(output, /keeper_rounds_seen_total 10/m);
  assert.match(output, /keeper_rounds_revealed_total 4/m);
  assert.match(output, /keeper_rounds_settled_total 2/m);
  // Not present (not incremented)
  assert.doesNotMatch(output, /keeper_rounds_failed_total/m);

  // Confirm multiple HELP/TYPE lines exist
  const helpCount = (output.match(/# HELP /g) || []).length;
  assert.equal(helpCount, 3);
});

test("reset clears all counters and histograms", () => {
  const m = createMetricsCollector();
  m.incRoundsSeen(10);
  m.incRoundsRevealed(5);
  m.observeSettleLatency(2.0);
  m.reset();

  const output = m.render();
  // After reset, everything is empty
  assert.equal(output, "\n");
});

test("metrics endpoint integration — GET /metrics returns text/plain", async () => {
  // This test verifies that the status server serves /metrics
  // when a metricsCollector is provided.
  const { createStatusServer } = await import("./status-server.js");
  const http = await import("node:http");

  const metricsCollector = createMetricsCollector();
  metricsCollector.incRoundsSeen(3);
  metricsCollector.incRoundsRevealed(1);

  const server = createStatusServer({
    host: "127.0.0.1",
    port: 0,
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB",
    network: "Test SDF Network ; September 2015",
    reader: {
      getRound: async () =>
        ({
          status: { tag: "Open" },
          reveal_round: BigInt(1_000_000),
          commit_deadline: BigInt(9999999999),
          reveal_deadline: BigInt(9999999999),
          bidders: [],
          winner: null,
          winning_bid: 0n,
          clearing_rule: { tag: "HighestBid" },
          auditor_pubkey: Buffer.from("aa"),
          item_ref: Buffer.from("bb".repeat(32), "hex"),
          operator: "GOPERATOR",
        }) as never,
      getBidState: async () =>
        ({
          commitment: Buffer.from("00"),
          escrow: 0n,
          revealed_nonce: undefined,
          revealed_value: undefined,
          settled: false,
          valid: false,
        }) as never,
    },
    drand: {
      chain: () => ({
        info: async () => ({ genesis_time: 1000, period: 3 }),
      }),
    } as never,
    storeRounds: () => [],
    metricsCollector,
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));

  try {
    const addr = server.address() as { port: number };
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${addr.port}/metrics`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        })
        .on("error", reject);
    });

    assert.equal(res.status, 200);
    // Should be plain text
    assert.match(res.body, /keeper_rounds_seen_total 3/m);
    assert.match(res.body, /keeper_rounds_revealed_total 1/m);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("metrics endpoint returns 404 when collector is not configured", async () => {
  const { createStatusServer } = await import("./status-server.js");
  const http = await import("node:http");

  const server = createStatusServer({
    host: "127.0.0.1",
    port: 0,
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB",
    network: "Test SDF Network ; September 2015",
    reader: {
      getRound: async () =>
        ({
          status: { tag: "Open" },
          reveal_round: BigInt(1_000_000),
          commit_deadline: BigInt(9999999999),
          reveal_deadline: BigInt(9999999999),
          bidders: [],
          winner: null,
          winning_bid: 0n,
          clearing_rule: { tag: "HighestBid" },
          auditor_pubkey: Buffer.from("aa"),
          item_ref: Buffer.from("bb".repeat(32), "hex"),
          operator: "GOPERATOR",
        }) as never,
      getBidState: async () =>
        ({
          commitment: Buffer.from("00"),
          escrow: 0n,
          revealed_nonce: undefined,
          revealed_value: undefined,
          settled: false,
          valid: false,
        }) as never,
    },
    drand: {
      chain: () => ({
        info: async () => ({ genesis_time: 1000, period: 3 }),
      }),
    } as never,
    storeRounds: () => [],
    // No metricsCollector
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));

  try {
    const addr = server.address() as { port: number };
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${addr.port}/metrics`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        })
        .on("error", reject);
    });

    assert.equal(res.status, 404);
    assert.match(res.body, /metrics collector not enabled/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
