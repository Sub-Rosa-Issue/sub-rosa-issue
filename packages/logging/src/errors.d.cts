// SPDX-License-Identifier: MIT
export type DiagnosticValue = null | string | number | boolean | DiagnosticValue[] | { [key: string]: DiagnosticValue };
export interface NormalizedError {
  name: string;
  message: string;
  code?: string | number;
  cause?: NormalizedError;
  stack?: string;
  retryable: boolean;
  context: Record<string, DiagnosticValue>;
}
/** Operator diagnostics; do not return this object in HTTP/UI responses. */
export function normalizeError(value: unknown, context?: unknown): NormalizedError;
/** Only fixed, safe copy is exposed at a public boundary. */
export function publicError(value: unknown): { message: string };
export function publicErrorMessage(value: unknown): string;
export function redactValue(value: unknown): DiagnosticValue;
