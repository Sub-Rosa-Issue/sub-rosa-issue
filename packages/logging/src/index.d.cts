// SPDX-License-Identifier: MIT
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string, level: LogLevel) => void;
export interface Logger {
  debug(event: string, message?: unknown, context?: unknown): void;
  info(event: string, message?: unknown, context?: unknown): void;
  warn(event: string, message?: unknown, context?: unknown): void;
  error(event: string, message?: unknown, context?: unknown): void;
}
export interface LoggerOptions {
  sink?: LogSink;
  clock?: () => string;
  /** Maximum characters retained per serialized string field. Defaults to 1000. */
  maxFieldLength?: number;
  /** Marker appended to a truncated string. Defaults to "...". */
  truncatedSuffix?: string;
}
export function createLogger(component: string, options?: LoggerOptions): Logger;
/** Write a machine-readable command result without a diagnostic envelope. */
export function writeData(text: string): void;

export interface TruncateOptions {
  /** Maximum number of characters retained from any single string. Defaults to 1000. */
  maxLength?: number;
  /** Marker appended to a truncated string. Defaults to "...". */
  truncatedSuffix?: string;
}
export const DEFAULT_MAX_LENGTH: number;
export const DEFAULT_TRUNCATED_SUFFIX: string;
/** Recursively truncate string values; cyclic references become `[Circular]`. */
export function truncateStrings(value: string, options?: TruncateOptions): string;
export function truncateStrings(value: unknown, options?: TruncateOptions): unknown;
/** Serialize an Error with every string field truncated and `stack` omitted. */
export function truncateError(err: Error, options?: TruncateOptions): Record<string, unknown>;
