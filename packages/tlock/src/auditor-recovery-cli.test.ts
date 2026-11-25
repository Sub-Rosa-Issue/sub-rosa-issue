// Copyright (c) 2026 Sub Rosa contributors
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

// ── Identity binding through the CLI (issue #382) ────────────────────────────
//
// A blob that decrypts but names a different bidder is a disclosure bug. These
// tests drive the CLI end-to-end and assert that each failure mode reports an
// error and emits no identity in any field.

import { sealIdentityForBidder } from "./auditor.js";

const enc = new TextEncoder();
const ROUND = 7777;
const OTHER_ROUND = 7778;
const ALICE_COMMITMENT = new Uint8Array(32).fill(0xa1);
const BOB_COMMITMENT = new Uint8Array(32).fill(0xb0);

function sealFor(
  auditor: ReturnType<typeof generateAuditorKeypair>,
  identity: string,
  round: number,
  commitment: Uint8Array,
): string {
  return toHex(
    sealIdentityForBidder({
      identity: enc.encode(identity),
      round,
      commitment,
      auditorPublicKey: auditor.publicKey,
    }),
  );
}

function rowOf(run: ReturnType<typeof runAuditorRecoveryCli>) {
  assert.equal(run.output.ok, true);
  if (!run.output.ok) throw new Error("expected ok output");
  const row = run.output.rows[0];
  assert.ok(row, "expected a row");
  return row;
}

test("CLI recovers the committed identity when round and commitment match", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    sealFor(auditor, "alice-secret-id", ROUND, ALICE_COMMITMENT),
    "--round",
    String(ROUND),
    "--commitment-hex",
    toHex(ALICE_COMMITMENT),
    "--label",
    "alice",
  ]);

  assert.equal(run.exitCode, 0);
  const row = rowOf(run);
  assert.equal(row.error, undefined);
  assert.equal(row.identityUtf8, "alice-secret-id");
});

test("CLI refuses a blob swapped between two bidders in the same round", () => {
  const auditor = generateAuditorKeypair();
  // Alice's blob presented as Bob's.
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    sealFor(auditor, "alice-secret-id", ROUND, ALICE_COMMITMENT),
    "--round",
    String(ROUND),
    "--commitment-hex",
    toHex(BOB_COMMITMENT),
    "--label",
    "bob",
  ]);

  assert.equal(run.exitCode, 0);
  const row = rowOf(run);
  assert.match(String(row.error), /commitment mismatch/i);
  // Nothing about the recovered identity may appear in the output.
  assert.equal(row.identityUtf8, undefined);
  assert.equal(row.identityHex, undefined);
  assert.equal(JSON.stringify(row).includes("alice-secret-id"), false);
});

test("CLI refuses a blob from another round", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    sealFor(auditor, "alice-secret-id", OTHER_ROUND, ALICE_COMMITMENT),
    "--round",
    String(ROUND),
    "--commitment-hex",
    toHex(ALICE_COMMITMENT),
    "--label",
    "alice",
  ]);

  assert.equal(run.exitCode, 0);
  const row = rowOf(run);
  assert.match(String(row.error), /round mismatch/i);
  assert.equal(row.identityUtf8, undefined);
  assert.equal(row.identityHex, undefined);
});

test("CLI rejects truncated hex before attempting decryption", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    // Odd length: invalid hex, so this must fail at parse time, before any
    // decryption is attempted.
    "--blob-hex",
    "0xabc",
  ]);

  const row = rowOf(run);
  assert.match(String(row.error), /even hex length/i);
  assert.equal(row.identityHex, undefined);
  assert.equal(row.identityUtf8, undefined);
});

test("CLI rejects a non-hex blob before attempting decryption", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    "zzzz",
  ]);

  const row = rowOf(run);
  assert.match(String(row.error), /valid hex/i);
  assert.equal(row.identityHex, undefined);
  assert.equal(row.identityUtf8, undefined);
});

test("CLI requires --round and --commitment-hex together", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    sealFor(auditor, "alice-secret-id", ROUND, ALICE_COMMITMENT),
    "--round",
    String(ROUND),
  ]);

  assert.equal(run.exitCode, 1);
  assert.equal(run.output.ok, false);
  if (run.output.ok) return;
  assert.match(run.output.error.message, /must be provided together/i);
});

test("CLI rejects a malformed --round value", () => {
  const auditor = generateAuditorKeypair();
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    sealFor(auditor, "alice-secret-id", ROUND, ALICE_COMMITMENT),
    "--round",
    "not-a-number",
    "--commitment-hex",
    toHex(ALICE_COMMITMENT),
  ]);

  assert.equal(run.exitCode, 1);
  assert.equal(run.output.ok, false);
});

test("CLI never leaks a recovered identity when the blob is not bound", () => {
  const auditor = generateAuditorKeypair();
  // A bound blob decrypted WITHOUT the expected round/commitment must not be
  // silently reported as a bare identity: that is the unbound path, and the
  // decoded bytes are the wrapper, not the bidder identity.
  const blobHex = sealFor(auditor, "alice-secret-id", ROUND, ALICE_COMMITMENT);
  const run = runAuditorRecoveryCli([
    "--auditor-secret-hex",
    toHex(auditor.secretKey),
    "--blob-hex",
    blobHex,
  ]);

  assert.equal(run.exitCode, 0);
  const row = rowOf(run);
  assert.match(String(row.error), /identity-bound but --round/i);
  assert.equal(row.identityUtf8, undefined, "must not emit an identity");
  assert.equal(row.identityHex, undefined, "must not emit identity bytes");
  assert.equal(JSON.stringify(row).includes("alice-secret-id"), false);
});
