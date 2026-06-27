// Round status indexer HTTP API.
// Exposes a stable JSON endpoint that dashboards and tools can poll
// to inspect keeper observations, round states, and settlement results.

import http from "http";
import { loadQueue, type QueueEntry } from "./queue.js";

export interface RoundStatusResponse {
  roundId: string;
  status: QueueEntry["status"];
  attempts: number;
  addedAt: string;
  lastAttempt?: string;
  error?: string;
}

export interface StatusApiResponse {
  ok: boolean;
  updatedAt: string;
  rounds: RoundStatusResponse[];
  summary: {
    total: number;
    pending: number;
    processing: number;
    settled: number;
    failed: number;
  };
}

/** Build a status response from the current queue. */
export function buildStatusResponse(): StatusApiResponse {
  const queue = loadQueue();
  const rounds: RoundStatusResponse[] = queue.entries.map(e => ({
    roundId: e.roundId,
    status: e.status,
    attempts: e.attempts,
    addedAt: e.addedAt,
    lastAttempt: e.lastAttempt,
    error: e.error,
  }));

  const summary = {
    total: rounds.length,
    pending: rounds.filter(r => r.status === "pending").length,
    processing: rounds.filter(r => r.status === "processing").length,
    settled: rounds.filter(r => r.status === "settled").length,
    failed: rounds.filter(r => r.status === "failed").length,
  };

  return { ok: true, updatedAt: queue.updatedAt, rounds, summary };
}

/**
 * Start a lightweight HTTP status server.
 * GET /status → StatusApiResponse
 * GET /health → { ok: true }
 */
export function startStatusServer(port = 7373): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.url === "/status" && req.method === "GET") {
      const body = JSON.stringify(buildStatusResponse(), null, 2);
      res.writeHead(200);
      res.end(body);
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });

  server.listen(port, () => {
    console.log(`[status-api] Listening on http://0.0.0.0:${port}`);
  });

  return server;
}
