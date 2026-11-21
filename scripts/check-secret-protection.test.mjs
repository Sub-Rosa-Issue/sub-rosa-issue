// Copyright (c) 2026 Sub Rosa contributors
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = new URL("check-secret-protection.mjs", import.meta.url).pathname;
const CWD = new URL("..", import.meta.url).pathname;

// Servidor de mentira que imita las respuestas de la API de GitHub que usa
// el script. Devuelve { url, requests, close }.
async function startFakeApi(responder) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
        authorization: req.headers.authorization,
      });
      const reply = responder(req, body ? JSON.parse(body) : null) ?? { status: 200, json: {} };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.json ?? {}));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runScript(args) {
  return execFileAsync("node", [SCRIPT_PATH, ...args], {
    cwd: CWD,
    encoding: "utf-8",
    env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "" },
  }).then(
    (result) => ({ code: 0, output: `${result.stdout}${result.stderr}` }),
    (error) => ({
      code: error.code ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    }),
  );
}

const ALL_ENABLED = {
  secret_scanning: { status: "enabled" },
  secret_scanning_push_protection: { status: "enabled" },
  secret_scanning_non_provider_patterns: { status: "enabled" },
  secret_scanning_validity_checks: { status: "enabled" },
};

describe("check-secret-protection", () => {
  it("passes when every secret-protection feature is enabled", async () => {
    const api = await startFakeApi(() => ({
      status: 200,
      json: { full_name: "acme/widgets", security_and_analysis: ALL_ENABLED },
    }));

    try {
      const result = await runScript(["--repo", "acme/widgets", "--token", "t", "--api-base", api.url]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /PASS: secret protection is enabled/);
      assert.match(result.output, /Push protection/);
    } finally {
      await api.close();
    }
  });

  it("fails when secret scanning is disabled", async () => {
    const api = await startFakeApi(() => ({
      status: 200,
      json: {
        security_and_analysis: {
          ...ALL_ENABLED,
          secret_scanning: { status: "disabled" },
        },
      },
    }));

    try {
      const result = await runScript(["--repo", "acme/widgets", "--token", "t", "--api-base", api.url]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /FAIL: secret protection is incomplete/);
      assert.match(result.output, /secret_scanning/);
    } finally {
      await api.close();
    }
  });

  it("treats optional features that the API does not expose as not available", async () => {
    const api = await startFakeApi(() => ({
      status: 200,
      json: {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
    }));

    try {
      const result = await runScript(["--repo", "acme/widgets", "--token", "t", "--api-base", api.url]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /not available for this repository\/plan/);
      assert.match(result.output, /not available here: secret_scanning_non_provider_patterns/);
    } finally {
      await api.close();
    }
  });

  it("fails when the API does not return the settings at all", async () => {
    const api = await startFakeApi(() => ({ status: 200, json: { full_name: "acme/widgets" } }));

    try {
      const result = await runScript(["--repo", "acme/widgets", "--token", "t", "--api-base", api.url]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /does not include security_and_analysis/);
    } finally {
      await api.close();
    }
  });

  it("explains a 403 as a permissions problem", async () => {
    const api = await startFakeApi(() => ({
      status: 403,
      json: { message: "Resource not accessible by integration" },
    }));

    try {
      const result = await runScript(["--repo", "acme/widgets", "--token", "t", "--api-base", api.url]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /Administration: read/);
    } finally {
      await api.close();
    }
  });

  it("enables every feature and re-reads the settings", async () => {
    const api = await startFakeApi((req) => {
      if (req.method === "PATCH") {
        return { status: 200, json: { security_and_analysis: ALL_ENABLED } };
      }
      return { status: 200, json: { security_and_analysis: ALL_ENABLED } };
    });

    try {
      const result = await runScript([
        "--repo",
        "acme/widgets",
        "--token",
        "t",
        "--api-base",
        api.url,
        "--enable",
      ]);
      assert.equal(result.code, 0, result.output);

      const patches = api.requests.filter((request) => request.method === "PATCH");
      assert.equal(patches.length, 4);
      for (const patch of patches) {
        const [key, value] = Object.entries(patch.body.security_and_analysis)[0];
        assert.equal(value.status, "enabled");
        assert.ok(key.startsWith("secret_scanning"), key);
      }
      assert.match(result.output, /PASS: secret protection is enabled/);
    } finally {
      await api.close();
    }
  });

  it("keeps going when a feature is rejected as unavailable (422)", async () => {
    const api = await startFakeApi((req, body) => {
      if (req.method === "PATCH") {
        const key = Object.keys(body.security_and_analysis)[0];
        if (key === "secret_scanning_non_provider_patterns") {
          return { status: 422, json: { message: "not available for this repository" } };
        }
        return { status: 200, json: { security_and_analysis: ALL_ENABLED } };
      }
      return {
        status: 200,
        json: {
          security_and_analysis: {
            secret_scanning: { status: "enabled" },
            secret_scanning_push_protection: { status: "enabled" },
            secret_scanning_validity_checks: { status: "enabled" },
          },
        },
      };
    });

    try {
      const result = await runScript([
        "--repo",
        "acme/widgets",
        "--token",
        "t",
        "--api-base",
        api.url,
        "--enable",
      ]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /not available for this repository\/plan/);
      assert.equal(api.requests.filter((request) => request.method === "PATCH").length, 4);
    } finally {
      await api.close();
    }
  });

  it("exits 2 with usage text when no token is available", async () => {
    const result = await runScript(["--repo", "acme/widgets"]);
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /No token found/);
  });

  it("prints a machine-readable summary with --json", async () => {
    const api = await startFakeApi(() => ({
      status: 200,
      json: { security_and_analysis: ALL_ENABLED },
    }));

    try {
      const result = await runScript([
        "--repo",
        "acme/widgets",
        "--token",
        "t",
        "--api-base",
        api.url,
        "--json",
      ]);
      assert.equal(result.code, 0, result.output);
      const jsonLine = result.output
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find((value) => value && value.repository === "acme/widgets");
      assert.ok(jsonLine, result.output);
      assert.equal(jsonLine.features.filter((feature) => feature.state === "enabled").length, 4);
      assert.equal(jsonLine.ok, true);
      assert.equal(jsonLine.features.length, 4);
    } finally {
      await api.close();
    }
  });
});
