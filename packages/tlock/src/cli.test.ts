import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateAuditorKeypair, sealIdentity } from "./auditor.js";

const CLI_PATH = path.join(process.cwd(), "src", "cli.ts");
const RUN_CMD = `node --import tsx ${CLI_PATH}`;

test("Auditor CLI Recovery", async (t) => {
  const keys = generateAuditorKeypair();
  const secretHex = bytesToHex(keys.secretKey);
  const identityBytes = new TextEncoder().encode("test-agent-alpha");
  const blobBytes = sealIdentity(identityBytes, keys.publicKey);
  const blobHex = bytesToHex(blobBytes);

  await t.test("successfully recovers a valid single blob", () => {
    const stdout = execSync(`${RUN_CMD} --blob ${blobHex} --secret ${secretHex}`).toString();
    const result = JSON.parse(stdout);
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recovered["single-blob"], "test-agent-alpha");
    assert.deepEqual(result.errors, {});
  });

  await t.test("fails on wrong secret key", () => {
    const wrongKeys = generateAuditorKeypair();
    const wrongSecretHex = bytesToHex(wrongKeys.secretKey);

    let stdout = "";
    try {
      execSync(`${RUN_CMD} --blob ${blobHex} --secret ${wrongSecretHex}`, { stdio: "pipe" });
      assert.fail("Should have exited non-zero");
    } catch (e: any) {
      stdout = e.stdout.toString();
    }

    const result = JSON.parse(stdout);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.recovered["single-blob"], undefined);
    // The exact noble-ciphers poly1305 error or MAC error string will be in errors
    assert.ok(result.errors["single-blob"]);
  });

  await t.test("fails on missing required args", () => {
    let stdout = "";
    try {
      execSync(`${RUN_CMD} --blob ${blobHex}`, { stdio: "pipe" });
      assert.fail("Should have exited non-zero");
    } catch (e: any) {
      stdout = e.stdout.toString();
    }
    const result = JSON.parse(stdout);
    assert.strictEqual(result.success, false);
    assert.ok(result.errors["secret"]);
  });

  await t.test("successfully parses and recovers from a JSON trace", () => {
    const trace = {
      auditor: {
        secretHex,
        blobs: {
          "agent-1": blobHex
        }
      }
    };
    const tmpFile = path.join(process.cwd(), ".tmp.trace.json");
    fs.writeFileSync(tmpFile, JSON.stringify(trace));

    try {
      // Omit --secret, let it pull from trace
      const stdout = execSync(`${RUN_CMD} --trace ${tmpFile}`).toString();
      const result = JSON.parse(stdout);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.recovered["agent-1"], "test-agent-alpha");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  await t.test("successfully parses from a TypeScript trace file (strip export const)", () => {
    const tsContent = `
// Generated trace
export const DEMO_TRACE = {
  "auditor": {
    "secretHex": "${secretHex}",
    "blobs": {
      "agent-2": "${blobHex}"
    }
  }
} as const;
`;
    const tmpFile = path.join(process.cwd(), ".tmp.trace.ts");
    fs.writeFileSync(tmpFile, tsContent);

    try {
      const stdout = execSync(`${RUN_CMD} --trace ${tmpFile}`).toString();
      const result = JSON.parse(stdout);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.recovered["agent-2"], "test-agent-alpha");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
