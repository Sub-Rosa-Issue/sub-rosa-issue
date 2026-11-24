// Copyright (c) 2026 Sub Rosa contributors
import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Canonical response/request header for appraisal quote correlation.
 * Clients may send it; the server always echoes a safe id back.
 */
export const APPRAISAL_REQUEST_ID_HEADER = "x-request-id";

/**
 * Maximum accepted inbound request-id length.
 *
 * 128 characters fits UUIDv4, common tracing ids, and short vendor prefixes
 * while bounding log amplification if a client sends a multi-kilobyte header.
 */
export const MAX_APPRAISAL_REQUEST_ID_LENGTH = 128;

/** Safe-by-construction charset: alphanumerics plus `.`, `_`, `-`. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a value is safe to reuse as an appraisal request id.
 *
 * Rejects missing/empty values, oversize strings, arrays (multi-header),
 * and any character outside the documented safe charset — including
 * whitespace and control characters that would corrupt quote tracing logs.
 */
export function isValidAppraisalRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_APPRAISAL_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  );
}

/** Read the first inbound `x-request-id` value from Node headers. */
export function readInboundAppraisalRequestId(
  headers: IncomingHttpHeaders,
): string | undefined {
  const raw = headers[APPRAISAL_REQUEST_ID_HEADER];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Resolve a log- and header-safe appraisal request id.
 *
 * Reuses a valid inbound `x-request-id`; otherwise generates a server id
 * (default: `randomUUID`). Invalid inbound values are never echoed or logged.
 */
export function resolveAppraisalRequestId(
  inbound: unknown,
  generate: () => string = randomUUID,
): string {
  return isValidAppraisalRequestId(inbound) ? inbound : generate();
}
