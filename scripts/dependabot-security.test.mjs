// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apply, evaluate, main, parseArgs, readState, DEFAULT_REPO } from "./dependabot-security.mjs";

const REPO = "acme/widget";

/**
 * Un `gh api` de mentira. `routes` mapea "METODO ruta" a la respuesta;
 * cualquier ruta no declarada responde 404, como GitHub sin permiso de admin.
 */
function fakeApi(routes = {}) {
  const calls = [];
  const api = (method, path) => {
    calls.push(`${method} ${path}`);
    return routes[`${method} ${path}`] ?? { ok: false, status: 404, body: "gh: Not Found (HTTP 404)" };
  };
  api.calls = calls;
  return api;
}

const PUBLIC_META = { ok: true, status: 200, body: JSON.stringify({ visibility: "public" }) };
const ALERTS_ON = { ok: true, status: 204, body: "" };
const FIXES = (enabled, paused = false) => ({ ok: true, status: 200, body: JSON.stringify({ enabled, paused }) });

function allEnabled() {
  return fakeApi({
    [`GET repos/${REPO}`]: PUBLIC_META,
    [`GET repos/${REPO}/vulnerability-alerts`]: ALERTS_ON,
    [`GET repos/${REPO}/automated-security-fixes`]: FIXES(true),
  });
}

describe("readState", () => {
  it("reports everything enabled on a public repo with alerts and fixes on", () => {
    assert.deepEqual(readState(REPO, allEnabled()), {
      visibility: "public",
      dependencyGraph: true,
      alerts: true,
      securityUpdates: true,
      securityUpdatesPaused: false,
    });
  });

  it("treats 404 on both endpoints as disabled", () => {
    const state = readState(REPO, fakeApi({ [`GET repos/${REPO}`]: PUBLIC_META }));
    assert.equal(state.alerts, false);
    assert.equal(state.securityUpdates, false);
  });

  it("returns unknown (null) for non-404 failures instead of guessing", () => {
    const forbidden = { ok: false, status: 403, body: "gh: Forbidden (HTTP 403)" };
    const state = readState(
      REPO,
      fakeApi({
        [`GET repos/${REPO}`]: PUBLIC_META,
        [`GET repos/${REPO}/vulnerability-alerts`]: forbidden,
        [`GET repos/${REPO}/automated-security-fixes`]: forbidden,
      }),
    );
    assert.equal(state.alerts, null);
    assert.equal(state.securityUpdates, null);
  });

  it("does not assume the dependency graph on a private repo", () => {
    const state = readState(
      REPO,
      fakeApi({ [`GET repos/${REPO}`]: { ok: true, status: 200, body: JSON.stringify({ visibility: "private" }) } }),
    );
    assert.equal(state.dependencyGraph, null);
  });

  it("surfaces a paused security-updates state", () => {
    const state = readState(
      REPO,
      fakeApi({
        [`GET repos/${REPO}`]: PUBLIC_META,
        [`GET repos/${REPO}/vulnerability-alerts`]: ALERTS_ON,
        [`GET repos/${REPO}/automated-security-fixes`]: FIXES(true, true),
      }),
    );
    assert.equal(state.securityUpdatesPaused, true);
  });
});

describe("evaluate", () => {
  it("passes only when every setting is enabled", () => {
    assert.equal(evaluate(readState(REPO, allEnabled())).ok, true);
    const partial = evaluate({ dependencyGraph: true, alerts: true, securityUpdates: false, securityUpdatesPaused: false });
    assert.equal(partial.ok, false);
    assert.equal(partial.rows.find((r) => r.id === "dependabot-security-updates").status, "disabled");
  });

  it("fails on paused security updates even if enabled", () => {
    const result = evaluate({ dependencyGraph: true, alerts: true, securityUpdates: true, securityUpdatesPaused: true });
    assert.equal(result.ok, false);
    assert.equal(result.rows.find((r) => r.id === "dependabot-security-updates").status, "paused");
  });
});

describe("apply", () => {
  it("enables alerts before security updates", () => {
    const api = fakeApi({
      [`PUT repos/${REPO}/vulnerability-alerts`]: ALERTS_ON,
      [`PUT repos/${REPO}/automated-security-fixes`]: ALERTS_ON,
    });
    const results = apply(REPO, api);
    assert.deepEqual(api.calls, [`PUT repos/${REPO}/vulnerability-alerts`, `PUT repos/${REPO}/automated-security-fixes`]);
    assert.ok(results.every((r) => r.ok));
  });

  it("stops after a failed alerts request", () => {
    const api = fakeApi();
    const results = apply(REPO, api);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(api.calls.length, 1);
  });
});

describe("parseArgs / main", () => {
  it("defaults to the upstream repo in check mode", () => {
    assert.deepEqual(parseArgs([]), { repo: DEFAULT_REPO, apply: false });
  });

  it("rejects malformed repos and unknown flags", () => {
    assert.throws(() => parseArgs(["--repo", "not-a-slug"]));
    assert.throws(() => parseArgs(["--repo"]));
    assert.throws(() => parseArgs(["--force"]));
  });

  it("exits 0 when enabled, 1 when not, 2 on bad usage", () => {
    assert.equal(main(["--repo", REPO], allEnabled()), 0);
    assert.equal(main(["--repo", REPO], fakeApi({ [`GET repos/${REPO}`]: PUBLIC_META })), 1);
    assert.equal(main(["--bogus"], fakeApi()), 2);
  });

  it("never sends write requests in check mode", () => {
    const api = allEnabled();
    main(["--repo", REPO], api);
    assert.ok(api.calls.every((c) => c.startsWith("GET ")));
  });
});
