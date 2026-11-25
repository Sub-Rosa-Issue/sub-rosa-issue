// Copyright (c) 2026 Sub Rosa contributors
import { createHash } from "node:crypto";
import { serializeReceipt, type RoundReceipt, type VerificationResult } from "@sub-rosa/sdk";
import { systemClock } from "@sub-rosa/time";

export interface JsonIssue {
  code: string;
  message: string;
  path?: string;
}

export interface JsonVerifyOutput {
  valid: boolean;
  receiptId: string | null;
  roundId: string | null;
  checkedAt: string;
  errors: JsonIssue[];
  warnings: JsonIssue[];
}

/**
 * Typed error codes the receipt CLI fails closed on. These are the
 * only outcomes that may be reported before the SDK verifier has accepted
 * the receipt. They are stable and machine-readable.
 */
export type ReceiptCliErrorCode =
  | "parse_error"
  | "missing_event"
  | "foreign_contract"
  | "unknown_schema_version"
  | "verification_failed";

export interface ReceiptCliError {
  code: ReceiptCliErrorCode;
  message: string;
  path?: string;
}

/**
 * Secret-shaped tokens that must never appear in CLI output. The
 * receipt CLI is an offline proof surface; a verifier failure must not
 * leak witness material through an error message.
 */
const SECRET_PATTERNS = [
  /[0-9a-f]{64}/gi, // 32-byte hex witnesses / keys
  /[0-9a-f]{128}/gi, // 64-byte hex witnesses / signatures
  /[a-z]{52}/g, // base32-like secret material
];

function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

function toErrorIssue(error: ReceiptCliError): JsonIssue {
  const issue: JsonIssue = {
    code: error.code,
    message: redactSecrets(error.message),
  };
  if (error.path) issue.path = error.path;
  return issue;
}

export function buildJsonOutput(
  receipt: RoundReceipt | null,
  result: VerificationResult | null,
  cliError: ReceiptCliError | null,
): JsonVerifyOutput {
  const checkedAt = systemClock.toISOString();

  // Fail closed: any typed error, missing receipt, or missing verifier
  // result produces an invalid result with no receipt identity and no
  // secret material.
  if (cliError !== null || receipt === null || result === null) {
    const error: ReceiptCliError = cliError ?? {
      code: "verification_failed",
      message: "Receipt verification did not produce a result",
    };
    return {
      valid: false,
      receiptId: null,
      roundId: null,
      checkedAt,
      errors: [toErrorIssue(error)],
      warnings: [],
    };
  }

  const canonical = serializeReceipt(receipt);
  const rid = createHash("sha256").update(canonical, "utf-8").digest("hex");

  const errors: JsonIssue[] = result.issues
    .filter((i) => i.severity === "error")
    .map((i) => {
      const issue: JsonIssue = { code: i.code, message: redactSecrets(i.message) };
      if (i.path) issue.path = i.path;
      return issue;
    });

  const warnings: JsonIssue[] = result.issues
    .filter((i) => i.severity === "warning")
    .map((i) => {
      const issue: JsonIssue = { code: i.code, message: redactSecrets(i.message) };
      if (i.path) issue.path = i.path;
      return issue;
    });

  // The SGK verifier owns the decision. If it rejects the receipt, the
  // CLI must not report success regardless of what the local formatter
  // believes.
  const valid = result.valid === true && errors.length === 0;

  return {
    valid,
    receiptId: valid ? rid : null,
    roundId: valid ? receipt.roundId : null,
    checkedAt,
    errors,
    warnings,
  };
}
