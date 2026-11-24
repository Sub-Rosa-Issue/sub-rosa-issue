// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { SECURITY_HEADERS, renderHeadersFile } from "./security-headers";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));

test("denies framing by any other origin", () => {
  assert.equal(SECURITY_HEADERS["Content-Security-Policy"], "frame-ancestors 'none'");
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
});

test("turns MIME sniffing off", () => {
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
});

test("the static-host _headers file matches the shared constant", () => {
  const shipped = readFileSync(`${webRoot}public/_headers`, "utf8");
  assert.equal(shipped, renderHeadersFile());
});

test("the Vite dev and preview servers send the same headers", () => {
  const config = readFileSync(`${webRoot}vite.config.ts`, "utf8");
  assert.match(config, /from "\.\/src\/lib\/security-headers"/);
  assert.match(config, /server:\s*{[^}]*headers: SECURITY_HEADERS/s);
  assert.match(config, /preview:\s*{[^}]*headers: SECURITY_HEADERS/s);
});

test("the deployment doc says where the headers are configured", () => {
  const doc = readFileSync(`${webRoot}../../docs/web-security-headers.md`, "utf8");
  for (const place of ["public/_headers", "vite.config.ts", "src/lib/security-headers.ts"]) {
    assert.ok(doc.includes(place), `doc should mention ${place}`);
  }
});
