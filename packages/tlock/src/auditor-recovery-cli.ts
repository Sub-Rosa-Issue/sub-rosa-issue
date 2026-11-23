import { normalizeError } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { readFileSync } from "node:fs";

import { isIdentityBound, openIdentity, openIdentityForBidder } from "./auditor.js";
import { fromHex, toHex } from "./commitment.js";

interface ParsedArgs {
  auditorSecretHex: string;
  inputJson?: string;
  inputJsonFile?: string;
  blobHex?: string;
  label: string;
  /// Expected Drand round the blob must be bound to.
  round?: number;
  /// Expected bid commitment hex the blob must be bound to.
  commitmentHex?: string;
}

interface BlobEntry {
  label: string;
  blobHex?: string;
}

export interface RecoveryRow {
  label: string;
  identityHex?: string;
  identityUtf8?: string;
  error?: string;
}

export interface RecoveryResult {
  ok: true;
  source: "hex" | "json";
  rows: RecoveryRow[];
}

interface CliError {
  code: string;
  message: string;
}

export interface CliRun {
  exitCode: number;
  output: RecoveryResult | { ok: false; error: CliError };
}

const HEX_RE = /^(?:0x)?[0-9a-fA-F]+$/;

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function parseHexStrict(hex: string, field: string): Uint8Array {
  const clean = normalizeHex(hex.trim());
  if (!clean) throw new Error(`${field} must be non-empty hex`);
  if (!HEX_RE.test(clean)) throw new Error(`${field} must be valid hex`);
  if (clean.length % 2 !== 0)
    throw new Error(`${field} must have even hex length`);
  return fromHex(clean);
}

function parseArgs(argv: string[]): ParsedArgs {
  let auditorSecretHex = "";
  let inputJson: string | undefined;
  let inputJsonFile: string | undefined;
  let blobHex: string | undefined;
  let label = "blob-0";
  let round: number | undefined;
  let commitmentHex: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const consume = () => {
      if (!next || next.startsWith("--")) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    if (arg === "--auditor-secret-hex") auditorSecretHex = consume();
    else if (arg === "--input-json") inputJson = consume();
    else if (arg === "--input-json-file") inputJsonFile = consume();
    else if (arg === "--blob-hex") blobHex = consume();
    else if (arg === "--label") label = consume();
    else if (arg === "--round") {
      const raw = consume();
      if (!/^\d+$/.test(raw)) {
        throw new Error(`--round must be a non-negative integer, got '${raw}'`);
      }
      round = Number(raw);
      if (!Number.isSafeInteger(round)) {
        throw new Error(`--round is out of range: ${raw}`);
      }
    } else if (arg === "--commitment-hex") commitmentHex = consume();
    else if (arg === "--help" || arg === "-h") {
      throw new Error("help requested");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!auditorSecretHex) {
    throw new Error("--auditor-secret-hex is required");
  }

  if (!inputJson && !inputJsonFile && !blobHex) {
    throw new Error(
      "provide one of --input-json, --input-json-file, or --blob-hex",
    );
  }

  // Identity binding is all-or-nothing: a round without its commitment (or the
  // reverse) cannot identify a bidder, so refuse rather than half-verify.
  if ((round === undefined) !== (commitmentHex === undefined)) {
    throw new Error("--round and --commitment-hex must be provided together");
  }

  return { auditorSecretHex, inputJson, inputJsonFile, blobHex, label, round, commitmentHex };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function extractBlobsFromJson(value: unknown): BlobEntry[] {
  const root = asRecord(value);
  if (!root) throw new Error("input JSON must be an object");

  const trace = asRecord(root.trace) ?? root;

  const directBlobs = asRecord(trace.blobs);
  if (directBlobs) {
    return Object.entries(directBlobs).map(([label, blob]) => ({
      label,
      blobHex: typeof blob === "string" ? blob : undefined,
    }));
  }

  const bidders = Array.isArray(trace.bidders) ? trace.bidders : null;

  const auditor = asRecord(trace.auditor);
  const auditorBlobs = auditor ? asRecord(auditor.blobs) : null;
  if (auditorBlobs) {
    if (bidders) {
      return bidders.map((item, index) => {
        const row = asRecord(item);
        const label =
          row && typeof row.label === "string" && row.label.trim()
            ? row.label
            : `bidder-${index}`;
        const blob = auditorBlobs[label];
        return { label, blobHex: typeof blob === "string" ? blob : undefined };
      });
    }

    return Object.entries(auditorBlobs).map(([label, blob]) => ({
      label,
      blobHex: typeof blob === "string" ? blob : undefined,
    }));
  }
  if (bidders) {
    return bidders.map((item, index) => {
      const row = asRecord(item);
      if (!row) return { label: `bidder-${index}`, blobHex: undefined };
      const label =
        typeof row.label === "string" ? row.label : `bidder-${index}`;
      const blobHex =
        typeof row.blobHex === "string"
          ? row.blobHex
          : typeof row.auditorBlobHex === "string"
            ? row.auditorBlobHex
            : undefined;
      return { label, blobHex };
    });
  }

  throw new Error(
    "input JSON must contain blobs at trace.auditor.blobs, auditor.blobs, blobs, or bidders[*].blobHex",
  );
}

function recoverRows(
  entries: BlobEntry[],
  auditorSecret: Uint8Array,
  expected?: { round: number; commitment: Uint8Array },
): RecoveryRow[] {
  return entries.map(({ label, blobHex }) => {
    if (!blobHex || !blobHex.trim()) {
      return { label, error: "missing blob hex" };
    }

    try {
      const blob = parseHexStrict(blobHex, `blob ${label}`);
      let plain: Uint8Array;
      if (expected) {
        // Verify the bid binding before the identity is ever rendered. On a
        // mismatch `openIdentityForBidder` throws and `plain` is never
        // assigned, so no identity reaches the output.
        const opened = openIdentityForBidder(blob, {
          auditorSecretKey: auditorSecret,
          round: expected.round,
          commitment: expected.commitment,
        });
        plain = opened.identity;
      } else {
        // Unbound recovery: the caller supplied no round/commitment to verify
        // against. A bound blob must still be refused here, because printing its
        // wrapper would leak the identity without proving which bidder it
        // belongs to — exactly the disclosure issue #382 closes.
        if (isIdentityBound(blob, auditorSecret)) {
          throw new Error(
            "auditor blob is identity-bound but --round and --commitment-hex were not supplied; refusing to print an unverified identity",
          );
        }
        plain = openIdentity(blob, auditorSecret);
      }
      return {
        label,
        identityHex: toHex(plain),
        identityUtf8: new TextDecoder().decode(plain),
      };
    } catch (error) {
      const message = normalizeError(error).message;
      return { label, error: message };
    }
  });
}

function loadInputJson(args: ParsedArgs, stdin: string): unknown {
  if (args.inputJsonFile) {
    const file = readFileSync(args.inputJsonFile, "utf8");
    return JSON.parse(file) as unknown;
  }

  const text = args.inputJson === "-" ? stdin : args.inputJson;
  if (!text) throw new Error("--input-json cannot be empty");
  return JSON.parse(text) as unknown;
}

export function runAuditorRecoveryCli(argv: string[], stdin = ""): CliRun {
  try {
    const args = parseArgs(argv);
    const auditorSecret = parseHexStrict(
      args.auditorSecretHex,
      "auditor secret",
    );
    if (auditorSecret.length !== 32) {
      return {
        exitCode: 1,
        output: {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "auditor secret must be 32 bytes (64 hex chars)",
          },
        },
      };
    }

    // Expected identity binding, when the caller supplied it. Parsed before any
    // decryption so a malformed commitment fails as bad input.
    let expected: { round: number; commitment: Uint8Array } | undefined;
    if (args.round !== undefined && args.commitmentHex !== undefined) {
      expected = {
        round: args.round,
        commitment: parseHexStrict(args.commitmentHex, "commitment"),
      };
    }

    if (args.blobHex) {
      const rows = recoverRows(
        [{ label: args.label, blobHex: args.blobHex }],
        auditorSecret,
        expected,
      );
      return { exitCode: 0, output: { ok: true, source: "hex", rows } };
    }

    const parsed = loadInputJson(args, stdin);
    const blobs = extractBlobsFromJson(parsed);
    if (blobs.length === 0) {
      return {
        exitCode: 1,
        output: {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "no bidder blobs found in JSON input",
          },
        },
      };
    }

    const rows = recoverRows(blobs, auditorSecret, expected);
    return { exitCode: 0, output: { ok: true, source: "json", rows } };
  } catch (error) {
    const message = normalizeError(error).message;
    return {
      exitCode: 1,
      output: {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message,
        },
      },
    };
  }
}

export function usage(): string {
  return [
    "Usage:",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --blob-hex <hex> [--label <name>]",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --input-json '<json>'",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --input-json-file <json-file>",
    "",
    "Identity binding (issue #382):",
    "  --round <n>            Drand round the blob must be bound to",
    "  --commitment-hex <hex> Bid commitment (32 bytes) the blob must be bound to",
    "  Supply both to verify a blob really belongs to the bidder it claims. A",
    "  swapped or cross-round blob then fails with an error and prints no",
    "  identity. Omitting them falls back to unbound legacy recovery.",
    "",
    "Input JSON supports:",
    "  - { auditor: { blobs: { [label]: hex } } }",
    "  - { trace: { auditor: { blobs: { [label]: hex } } } }",
    "  - { blobs: { [label]: hex } }",
    "  - { bidders: [{ label, blobHex | auditorBlobHex }] }",
  ].join("\n");
}
