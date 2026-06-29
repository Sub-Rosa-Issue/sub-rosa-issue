import { createHash } from "node:crypto";
import { serializeReceipt, type RoundReceipt, type VerificationResult } from "@sub-rosa/sdk";

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

export function buildJsonOutput(
  receipt: RoundReceipt | null,
  result: VerificationResult | null,
  parseError: string | null,
): JsonVerifyOutput {
  const checkedAt = new Date().toISOString();

  if (parseError !== null || receipt === null || result === null) {
    return {
      valid: false,
      receiptId: null,
      roundId: null,
      checkedAt,
      errors: [{ code: "parse_error", message: parseError ?? "Unknown error" }],
      warnings: [],
    };
  }

  const canonical = serializeReceipt(receipt);
  const rid = createHash("sha256").update(canonical, "utf-8").digest("hex");

  const errors: JsonIssue[] = result.issues
    .filter((i) => i.severity === "error")
    .map((i) => {
      const issue: JsonIssue = { code: i.code, message: i.message };
      if (i.path) issue.path = i.path;
      return issue;
    });

  const warnings: JsonIssue[] = result.issues
    .filter((i) => i.severity === "warning")
    .map((i) => {
      const issue: JsonIssue = { code: i.code, message: i.message };
      if (i.path) issue.path = i.path;
      return issue;
    });

  return {
    valid: result.valid,
    receiptId: rid,
    roundId: receipt.roundId,
    checkedAt,
    errors,
    warnings,
  };
}
