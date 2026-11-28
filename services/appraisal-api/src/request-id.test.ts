// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { describe, test } from "node:test";

import { createLogger } from "@sub-rosa/logging";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";

import { validRequest } from "./fixtures/index.js";
import {
  APPRAISAL_REQUEST_ID_HEADER,
  MAX_APPRAISAL_REQUEST_ID_LENGTH,
  isValidAppraisalRequestId,
  readInboundAppraisalRequestId,
  resolveAppraisalRequestId,
} from "./request-id.js";
import { buildAppraisalServer } from "./server.js";

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

async function buildTestServer(options: Parameters<typeof buildAppraisalServer>[1] = {}) {
  const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
  const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
  return buildAppraisalServer(
    {
      facilitatorSecret: facilitator.secret(),
      payTo: payee.publicKey(),
      asset: USDC_TESTNET_ADDRESS,
      price: 0.1,
      network: STELLAR_TESTNET_CAIP2,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: "https://soroban-testnet.stellar.org",
      port: 0,
    },
    { nowSeconds: () => 1_700_000_000, ...options },
  );
}

describe("appraisal request id sanitization", () => {
  test("documents and enforces the maximum header length", () => {
    assert.equal(MAX_APPRAISAL_REQUEST_ID_LENGTH, 128);
    assert.equal(isValidAppraisalRequestId("a".repeat(128)), true);
    assert.equal(isValidAppraisalRequestId("a".repeat(129)), false);
  });

  test("preserves printable safe ids up to the cap", () => {
    const safe = [
      "request-123",
      "trace_01HZX.abc-def",
      "550e8400-e29b-41d4-a716-446655440000",
      "a".repeat(MAX_APPRAISAL_REQUEST_ID_LENGTH),
    ];
    for (const id of safe) {
      assert.equal(resolveAppraisalRequestId(id, () => "generated"), id);
    }
  });

  test("replaces missing, overlong, or control-character values with a server id", () => {
    const generated = "server-generated-id";
    const unsafe = [
      undefined,
      "",
      123,
      ["a", "b"],
      "line\nforged",
      "line\rforged",
      "column\tforged",
      "ansi\x1b[31m",
      "nul\u0000byte",
      "id with space",
      "id/slash",
      "a".repeat(MAX_APPRAISAL_REQUEST_ID_LENGTH + 1),
    ];
    for (const value of unsafe) {
      assert.equal(resolveAppraisalRequestId(value, () => generated), generated);
    }
  });

  test("reads a single inbound x-request-id and rejects duplicate values", () => {
    assert.equal(
      readInboundAppraisalRequestId({ [APPRAISAL_REQUEST_ID_HEADER]: "abc-123" }),
      "abc-123",
    );
    assert.equal(
      readInboundAppraisalRequestId({ [APPRAISAL_REQUEST_ID_HEADER]: ["first", "second"] }),
      undefined,
    );
    assert.equal(readInboundAppraisalRequestId({}), undefined);
  });
});

describe("appraisal request id response headers", () => {
  test("echoes a safe inbound x-request-id on quotes and errors", async () => {
    const inbound = "client-trace-01";
    const server = await buildTestServer();
    const port = await listen(server);
    try {
      const challenge = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [APPRAISAL_REQUEST_ID_HEADER]: inbound,
        },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(challenge.status, 402);
      assert.equal(challenge.headers.get(APPRAISAL_REQUEST_ID_HEADER), inbound);

      const bad = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [APPRAISAL_REQUEST_ID_HEADER]: inbound,
        },
        body: "",
      });
      assert.equal(bad.status, 400);
      assert.equal(bad.headers.get(APPRAISAL_REQUEST_ID_HEADER), inbound);

      const health = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { [APPRAISAL_REQUEST_ID_HEADER]: inbound },
      });
      assert.equal(health.status, 200);
      assert.equal(health.headers.get(APPRAISAL_REQUEST_ID_HEADER), inbound);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("replaces unsafe inbound ids (spaces, overlong) in the response header", async () => {
    const generated = "safe-server-id";
    const server = await buildTestServer({ generateRequestId: () => generated });
    const port = await listen(server);
    try {
      for (const unsafe of ["id with space", "a".repeat(MAX_APPRAISAL_REQUEST_ID_LENGTH + 1)]) {
        const challenge = await fetch(`http://127.0.0.1:${port}/appraise`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [APPRAISAL_REQUEST_ID_HEADER]: unsafe,
          },
          body: JSON.stringify(validRequest.value),
        });
        assert.equal(challenge.status, 402);
        assert.equal(challenge.headers.get(APPRAISAL_REQUEST_ID_HEADER), generated);
      }
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe("appraisal request id logging", () => {
  test("structured logs record the safe server id, never unsafe inbound content", () => {
    const unsafe = "attacker\nforged-log-entry";
    const generated = "safe-server-id";
    const lines: string[] = [];
    const logger = createLogger("appraisal-api.server.test", {
      sink: (line) => {
        lines.push(line);
      },
    });

    const requestId = resolveAppraisalRequestId(unsafe, () => generated);
    assert.equal(requestId, generated);

    // Mirrors the server catch path: log.error("request-failed", err, { requestId }).
    logger.error("request-failed", "forced-handler-failure", { requestId });

    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]!) as {
      event: string;
      context: { requestId: string };
    };
    assert.equal(record.event, "request-failed");
    assert.equal(record.context.requestId, generated);
    assert.ok(!lines[0]!.includes("forged-log-entry"));
    assert.ok(!lines[0]!.includes("attacker"));
  });

  test("server 402 path never echoes an overlong inbound id into logs via headers", async () => {
    const unsafe = "a".repeat(MAX_APPRAISAL_REQUEST_ID_LENGTH + 1);
    const generated = "safe-server-id";
    const lines: string[] = [];
    const logger = createLogger("appraisal-api.server.test", {
      sink: (line) => {
        lines.push(line);
      },
    });
    const server = await buildTestServer({
      generateRequestId: () => generated,
      logger,
    });
    const port = await listen(server);
    try {
      const challenge = await fetch(`http://127.0.0.1:${port}/appraise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [APPRAISAL_REQUEST_ID_HEADER]: unsafe,
        },
        body: JSON.stringify(validRequest.value),
      });
      assert.equal(challenge.status, 402);
      assert.equal(challenge.headers.get(APPRAISAL_REQUEST_ID_HEADER), generated);
      // No request-failed log on the happy 402 path; confirm nothing logged the overlong id.
      for (const line of lines) {
        assert.ok(!line.includes(unsafe));
      }
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
