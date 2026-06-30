import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { generateAuditorKeypair, sealIdentity } from "./auditor.js";
import { toHex } from "./commitment.js";
import { runAuditorRecoveryCli } from "./auditor-recovery-cli.js";

test("CLI recovery succeeds for valid secret + blob", () => {
  const auditor = generateAuditorKeypair();
  const identity = new TextEncoder().encode("agent:GALICE123");
  const blobHex = toHex(sealIdentity(identity, auditor.publicKey));

  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    blobHex,
    "--label",
    "agent-alpha",
  ]);

  assert.equal(run.exitCode, 0);
  assert.equal(run.output.ok, true);
  if (!run.output.ok) return;
  assert.equal(run.output.rows.length, 1);
  assert.equal(run.output.rows[0]?.label, "agent-alpha");
  assert.equal(run.output.rows[0]?.identityUtf8, "agent:GALICE123");
  assert.equal(run.output.rows[0]?.error, undefined);
});

test("CLI reports per-blob errors for wrong key without invalid-input exit", () => {
  const auditor = generateAuditorKeypair();
  const wrong = generateAuditorKeypair();

  const okIdentity = new TextEncoder().encode("agent:GBOB456");
  const blobOk = toHex(sealIdentity(okIdentity, auditor.publicKey));
  const blobWrong = toHex(sealIdentity(okIdentity, wrong.publicKey));

  const payload = JSON.stringify({
    auditor: {
      blobs: {
        "agent-valid": blobOk,
        "agent-wrong-key": blobWrong,
        "agent-missing": "",
      },
    },
  });

  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--input-json",
    payload,
  ]);

  assert.equal(run.exitCode, 0);
  assert.equal(run.output.ok, true);
  if (!run.output.ok) return;

  const rowsByLabel = new Map(run.output.rows.map((row) => [row.label, row]));
  assert.equal(rowsByLabel.get("agent-valid")?.identityUtf8, "agent:GBOB456");
  assert.ok(rowsByLabel.get("agent-wrong-key")?.error);
  assert.match(
    rowsByLabel.get("agent-wrong-key")?.error ?? "",
    /invalid|authenticate|decrypt/i,
  );
  assert.equal(rowsByLabel.get("agent-missing")?.error, "missing blob hex");
});

test("CLI accepts canonical trace-style JSON file input", () => {
  const auditor = generateAuditorKeypair();
  const identity = new TextEncoder().encode("agent:GTRACE999");
  const blob = toHex(sealIdentity(identity, auditor.publicKey));

  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-auditor-cli-"));
  const path = join(dir, "trace.json");
  writeFileSync(
    path,
    JSON.stringify({
      trace: {
        bidders: [{ label: "agent-alpha" }, { label: "agent-missing" }],
        auditor: { blobs: { "agent-alpha": blob } },
      },
    }),
    "utf8",
  );

  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--input-json-file",
    path,
  ]);

  assert.equal(run.exitCode, 0);
  assert.equal(run.output.ok, true);
  if (!run.output.ok) return;
  const rowsByLabel = new Map(run.output.rows.map((row) => [row.label, row]));
  assert.equal(rowsByLabel.get("agent-alpha")?.identityUtf8, "agent:GTRACE999");
  assert.equal(rowsByLabel.get("agent-missing")?.error, "missing blob hex");
});

test("CLI returns non-zero for invalid required inputs", () => {
  const run = runAuditorRecoveryCli(["--blob-hex", "abcd"]);
  assert.equal(run.exitCode, 1);
  assert.equal(run.output.ok, false);
  if (run.output.ok) return;
  assert.equal(run.output.error.code, "INVALID_INPUT");
});
