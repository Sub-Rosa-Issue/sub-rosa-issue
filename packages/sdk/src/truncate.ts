/**
 * Truncates oversized string fields in structured data (objects, arrays, error objects)
 * to prevent log inflation and accidental retention of sensitive context.
 *
 * Acceptance criteria for issue #667:
 * - Add a configurable maximum serialized string length in the shared logging package.
 * - Mark truncated values without including discarded content.
 * - Handle nested fields consistently.
 * - Add tests for strings, arrays, and error objects.
 *
 * The `maxLength` parameter is configurable by the caller.
 * Truncated values are marked with a suffix so the caller knows content was discarded.
 */
export type TruncateOptions = {
  /** Maximum length for any string value. Defaults to 100. */
  maxLength?: number;
  /** Suffix to append to truncated values. */
  truncatedSuffix?: string;
};

/**
 * Recursively truncate string values in data structures.
 *
 * - Strings longer than `maxLength` are truncated and suffix-appended.
 * - Objects and arrays are recursed into, preserving structure.
 * - Non-string values are returned as-is.
 *
 * @param data The data structure to truncate (object, array, or primitive).
 * @param options Configuration for truncation behavior.
 * @returns A new data structure with strings truncated beyond `maxLength`.
 */
export function truncateStrings(
  data: unknown,
  options: TruncateOptions = {},
): unknown {
  const { maxLength = 100, truncatedSuffix = "..." } = options;
  const marker = truncatedSuffix;

  if (typeof data === "string") {
    return data.length > maxLength
      ? data.slice(0, maxLength) + marker
      : data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => truncateStrings(item, options));
  }

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
 * Truncates string fields in an Error object, preserving the error class and
 * non-string properties.  Useful for serializing errors in logs without
 * leaking large stack traces or sensitive data.
 *
 * @param err The Error instance to truncate.
 * @param options Configuration for truncation behavior.
 * @returns A plain object with all string values truncated, suitable for logging.
 */
export function truncateError(
  err: Error,
  options: TruncateOptions = {},
): Record<string, unknown> {
  const { maxLength = 100, truncatedSuffix = "..." } = options;
  const result: Record<string, unknown> = {
    name: err.name,
    message: truncateStrings(err.message, { maxLength, truncatedSuffix }) as string,
  };

  // Copy own enumerable properties that are strings or objects/arrays
  // (but not the prototype chain methods like stack, etc.)
  for (const key of Object.keys(err) as (keyof Error)[]) {
    if (key === "stack" || key === "message") continue;
    const value = (err as any)[key];
    if (typeof value === "string") {
      result[key] = truncateStrings(value, { maxLength, truncatedSuffix });
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Recursively truncate nested objects
      result[key] = truncateStrings(value, { maxLength, truncatedSuffix });
    } else if (Array.isArray(value)) {
      result[key] = truncateStrings(value, { maxLength, truncatedSuffix });
    }
  }

  return result;
}