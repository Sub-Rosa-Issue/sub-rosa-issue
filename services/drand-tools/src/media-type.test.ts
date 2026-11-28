import assert from "node:assert/strict";
import { test } from "node:test";
import { DrandMediaTypeError, getBeacon, getChainInfo, QUICKNET_HASH } from "./quicknet.js";

const config = { apiUrl: "https://drand.invalid", expectedChainHash: QUICKNET_HASH };

test("rejects unsupported and missing media types before parsing chain and beacon bodies", async () => {
  for (const type of [undefined, "text/html"]) {
    const unexpected = () => new Response(new Uint8Array(), {
      headers: type ? { "content-type": type } : undefined,
    });
    await assert.rejects(getChainInfo(async () => unexpected(), config), DrandMediaTypeError);
    await assert.rejects(getBeacon(101, async (url) =>
      String(url).endsWith("/info")
        ? new Response(JSON.stringify({ hash: QUICKNET_HASH }), {
            headers: { "content-type": "application/json; charset=UTF-8" },
          })
        : unexpected(),
    config), DrandMediaTypeError);
  }
});
