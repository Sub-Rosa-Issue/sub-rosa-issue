// Copyright (c) 2026 Sub Rosa contributors
/**
 * Truncates oversized string fields in structured data (objects, arrays and
 * error objects) so a single large upstream error or malformed input cannot
 * inflate log volume or carry more sensitive context than the caller intended.
 *
 * Acceptance criteria for issue #667:
 * - A configurable maximum serialized string length.
 * - Truncated values are marked without retaining the discarded content.
 * - Nested fields are handled consistently.
 * - Tests cover strings, arrays and error objects.
 *
 * A string is truncated only when it is strictly longer than `maxLength`. The
 * retained prefix is at most `maxLength` characters and the marker records that
 * content was dropped. The discarded tail is never copied into the result.
 */

/** Marker used when the caller does not supply `truncatedSuffix`. */
export const DEFAULT_TRUNCATED_SUFFIX = "...";

/** Retained characters per string when the caller does not supply `maxLength`. */
export const DEFAULT_MAX_LENGTH = 100;

export interface TruncateOptions {
  /** Maximum number of characters retained from any single string. Defaults to 100. */
  maxLength?: number;
  /** Marker appended to a truncated string. Defaults to "...". */
  truncatedSuffix?: string;
}

function resolveOptions(options: TruncateOptions): Required<TruncateOptions> {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError(`maxLength must be a non-negative integer; received ${String(options.maxLength)}`);
  }
  return {
    maxLength,
    truncatedSuffix: options.truncatedSuffix ?? DEFAULT_TRUNCATED_SUFFIX,
  };
}

function truncateString(value: string, maxLength: number, truncatedSuffix: string): string {
  return value.length > maxLength ? value.slice(0, maxLength) + truncatedSuffix : value;
}

/**
 * Recursively truncates string values in a data structure.
 *
 * - Strings longer than `maxLength` keep their first `maxLength` characters and
 *   gain the marker; the discarded remainder is dropped.
 * - Arrays and plain objects are recursed into, preserving their shape and order.
 * - Every other value (null, undefined, numbers, booleans, bigint) is returned as
 *   it was, so callers can pass a heterogeneous log context directly.
 *
 * @throws RangeError when `maxLength` is negative or not an integer.
 */
export function truncateStrings(value: string, options?: TruncateOptions): string;
export function truncateStrings(value: unknown, options?: TruncateOptions): unknown;
export function truncateStrings(data: unknown, options: TruncateOptions = {}): unknown {
  const { maxLength, truncatedSuffix } = resolveOptions(options);

  if (typeof data === "string") return truncateString(data, maxLength, truncatedSuffix);
  // Error members are non-enumerable, so an Error needs its own pass before the
  // generic object walk; callers often nest errors inside log context.
  if (data instanceof Error) return truncateError(data, options);
  if (Array.isArray(data)) return data.map((item) => truncateStrings(item, options));
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateStrings(value, options);
    }
    return result;
  }
  return data;
}

/**
 * Serializes an Error for logging with every string field truncated.
 *
 * Own enumerable properties are kept (including `cause` and custom fields such
 * as `code`), `name` and `message` are preserved, and `stack` is omitted: it is
 * the largest and most incidental field of a logged error and its content is
 * already represented by the message.
 *
 * @throws RangeError when `maxLength` is negative or not an integer.
 */
export function truncateError(err: Error, options: TruncateOptions = {}): Record<string, unknown> {
  const { maxLength, truncatedSuffix } = resolveOptions(options);
  const result: Record<string, unknown> = {
    name: truncateString(err.name, maxLength, truncatedSuffix),
    message: truncateString(err.message, maxLength, truncatedSuffix),
  };

  for (const [key, value] of Object.entries(err)) {
    if (key === "name" || key === "message" || key === "stack") continue;
    result[key] = truncateStrings(value, { maxLength, truncatedSuffix });
  }
  return result;
}
