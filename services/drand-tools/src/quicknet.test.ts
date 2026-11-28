// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeError } from "@sub-rosa/logging/errors";
import { createLogger } from "@sub-rosa/logging";

import {
  DRAND_HTTP_REDIRECT_CATEGORY,
  DrandRedirectError,
  QUICKNET_HASH,
  getBeacon as fetchBeacon,
  getChainInfo as fetchChainInfo,
  isHttpRedirectStatus,
} from "./quicknet.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

interface RedirectFixture {
  description: string;
  resource: "chain-info" | "beacon";
  status: number;
  headers: { Location: string };
}

function loadRedirectFixture(name: string): RedirectFixture {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as RedirectFixture;
}

function redirectFetch(fixture: RedirectFixture): typeof fetch {
  return async (_url, init) => {
    assert.equal(init?.redirect, "manual");
    return new Response("", {
      status: fixture.status,
      headers: fixture.headers,
    });
  };
}

const config = { apiUrl: "https://drand.invalid", expectedChainHash: QUICKNET_HASH };

function getChainInfo(fetchImpl: typeof fetch) {
  return fetchChainInfo(fetchImpl, config);
}

function getBeacon(round: number | "latest", fetchImpl: typeof fetch) {
  return fetchBeacon(round, (url, init) => {
    if (String(url).endsWith("/info")) {
      assert.equal(init?.redirect, "manual");
      return Promise.resolve(new Response(JSON.stringify({ hash: QUICKNET_HASH }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }
    return fetchImpl(url, init);
  }, config);
}

describe("Drand HTTP redirect rejection", () => {
  it("disables automatic redirects for chain-info fetches", async () => {
    let seenRedirect: RequestRedirect | undefined;
    await getChainInfo(async (_url, init) => {
      seenRedirect = init?.redirect;
      return new Response(
        JSON.stringify({
          public_key: "ab",
          period: 3,
          genesis_time: 1,
          hash: QUICKNET_HASH,
          schemeID: "bls-unchained-g1-rfc9380",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    assert.equal(seenRedirect, "manual");
  });

  it("disables automatic redirects for beacon fetches", async () => {
    let seenRedirect: RequestRedirect | undefined;
    await getBeacon(1, async (_url, init) => {
      seenRedirect = init?.redirect;
      return new Response(
        JSON.stringify({ round: 1, randomness: "aa", signature: "bb" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    assert.equal(seenRedirect, "manual");
  });

  it("rejects chain-info redirects with one stable error category and no Location", async () => {
    const fixture = loadRedirectFixture("drand-redirect-chain-info.json");
    await assert.rejects(
      () => getChainInfo(redirectFetch(fixture)),
      (error: unknown) => {
        assert.ok(error instanceof DrandRedirectError);
        assert.equal(error.category, DRAND_HTTP_REDIRECT_CATEGORY);
        assert.equal(error.category, "http_redirect");
        assert.equal(error.resource, "chain-info");
        assert.equal(error.status, fixture.status);
        assert.ok(isHttpRedirectStatus(error.status));
        assert.ok(!error.message.includes(fixture.headers.Location));
        assert.ok(!error.message.includes("attacker.example"));
        assert.ok(!error.message.includes("secret-chain"));
        assert.ok(!JSON.stringify(error).includes(fixture.headers.Location));
        assert.ok(!("location" in error));
        assert.ok(!("Location" in error));
        return true;
      },
    );
  });

  it("rejects beacon redirects with the same stable category and no Location", async () => {
    const fixture = loadRedirectFixture("drand-redirect-beacon.json");
    await assert.rejects(
      () => getBeacon("latest", redirectFetch(fixture)),
      (error: unknown) => {
        assert.ok(error instanceof DrandRedirectError);
        assert.equal(error.category, DRAND_HTTP_REDIRECT_CATEGORY);
        assert.equal(error.resource, "beacon");
        assert.equal(error.status, fixture.status);
        assert.ok(!error.message.includes(fixture.headers.Location));
        assert.ok(!error.message.includes("evil.example"));
        assert.ok(!error.message.includes("secret-round"));
        assert.ok(!JSON.stringify(error).includes("evil.example"));
        return true;
      },
    );
  });

  it("uses one category for every 3xx status", () => {
    const categories = [301, 302, 303, 307, 308].map(
      (status) => new DrandRedirectError("beacon", status).category,
    );
    assert.ok(categories.every((c) => c === DRAND_HTTP_REDIRECT_CATEGORY));
  });

  it("does not include Location headers in diagnostic logs", () => {
    const fixture = loadRedirectFixture("drand-redirect-beacon.json");
    const error = DrandRedirectError.fromResponse(
      "beacon",
      new Response("", { status: fixture.status, headers: fixture.headers }),
    );
    const lines: string[] = [];
    const diagnostics = createLogger("services.drand-tools.src.quicknet.test", {
      sink: (line) => {
        lines.push(line);
      },
    });
    diagnostics.error(error.category, "drand fetch redirected", {
      err: normalizeError(error),
    });
    const joined = lines.join("\n");
    assert.ok(joined.includes(DRAND_HTTP_REDIRECT_CATEGORY));
    assert.ok(!joined.includes(fixture.headers.Location));
    assert.ok(!joined.includes("evil.example"));
    assert.ok(!joined.includes("secret-round"));
    assert.ok(!/location/i.test(joined));
  });
});
