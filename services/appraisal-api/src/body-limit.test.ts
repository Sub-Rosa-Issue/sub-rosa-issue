// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";

import {
  APPRAISAL_BODY_TOO_LARGE,
  takeAppraisalRequestBody,
} from "./body-limit.js";

function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP port");
    }
    return address.port;
  });
}

function fakeRequest(headers: http.IncomingHttpHeaders, body: Buffer): IncomingMessage {
  const stream = new PassThrough();
  const req = Object.assign(stream, { headers }) as IncomingMessage;
  queueMicrotask(() => {
    stream.end(body);
  });
  return req;
}

describe("appraisal request body cap", () => {
  test("rejects a declared Content-Length above the cap before the body is parsed", async () => {
    const req = fakeRequest({ "content-length": "8193" }, Buffer.from("{}"));
    const taken = await takeAppraisalRequestBody(req, 8192);
    assert.ok("status" in taken);
    assert.equal(taken.status, 413);
    assert.deepEqual(taken.body, {
      error: APPRAISAL_BODY_TOO_LARGE,
      limitBytes: 8192,
    });
  });

  test("returns 413 for an oversized stream and still parses a small JSON body", async () => {
    const server = http.createServer(async (req, res) => {
      const taken = await takeAppraisalRequestBody(req, 32);
      if ("status" in taken) {
        res.writeHead(taken.status, { "content-type": "application/json" });
        res.end(JSON.stringify(taken.body));
        return;
      }
      JSON.parse(taken.raw.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);
    try {
      const oversized = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(33),
      });
      assert.equal(oversized.status, 413);
      assert.deepEqual(await oversized.json(), {
        error: APPRAISAL_BODY_TOO_LARGE,
        limitBytes: 32,
      });

      const allowed = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
      assert.equal(allowed.status, 200);
    } finally {
      server.close();
    }
  });
});
