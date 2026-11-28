// SPDX-License-Identifier: MIT
'use strict';

/**
 * Truncates oversized string fields before they reach a diagnostic record so a
 * large upstream error or malformed input cannot inflate log volume or retain
 * more context than the caller intended.
 *
 * A string is truncated only when it is strictly longer than `maxLength`. The
 * discarded tail is never copied into the result.
 */

const DEFAULT_MAX_LENGTH = 1000;
const DEFAULT_TRUNCATED_SUFFIX = '...';
const CIRCULAR = '[Circular]';

function resolveOptions(options = {}) {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError(`maxLength must be a non-negative integer; received ${String(options.maxLength)}`);
  }
  return {
    maxLength,
    truncatedSuffix: options.truncatedSuffix ?? DEFAULT_TRUNCATED_SUFFIX,
  };
}

function truncateString(value, maxLength, truncatedSuffix) {
  return value.length > maxLength ? value.slice(0, maxLength) + truncatedSuffix : value;
}

function truncateValue(data, options, seen) {
  if (typeof data === 'string') {
    return truncateString(data, options.maxLength, options.truncatedSuffix);
  }
  // Error members are non-enumerable, so an Error needs its own pass before the
  // generic object walk; callers often nest errors inside log context.
  if (data instanceof Error) return truncateError(data, options, seen);
  if (data === null || typeof data !== 'object') return data;
  if (seen.has(data)) return CIRCULAR;
  seen.add(data);
  try {
    if (Array.isArray(data)) return data.map((item) => truncateValue(item, options, seen));
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateValue(value, options, seen);
    }
    return result;
  } finally {
    seen.delete(data);
  }
}

/**
 * Recursively truncates string values in a data structure.
 *
 * Strings keep their first `maxLength` characters and gain the marker; arrays
 * and plain objects are recursed into; every other primitive is returned as it
 * was. Cyclic references become `[Circular]` instead of recursing forever.
 *
 * @throws RangeError when `maxLength` is negative or not an integer.
 */
function truncateStrings(data, options = {}) {
  return truncateValue(data, resolveOptions(options), new WeakSet());
}

/**
 * Serializes an Error with every string field truncated.
 *
 * Own enumerable properties are kept (including `cause` and custom fields such
 * as `code`), `name` and `message` are preserved, and `stack` is omitted.
 *
 * @throws RangeError when `maxLength` is negative or not an integer.
 */
function truncateError(err, options = {}, seen = new WeakSet()) {
  const resolved = resolveOptions(options);
  if (seen.has(err)) return CIRCULAR;
  const result = {
    name: truncateString(String(err && err.name !== undefined ? err.name : 'Error'), resolved.maxLength, resolved.truncatedSuffix),
    message: truncateString(String(err && err.message !== undefined ? err.message : ''), resolved.maxLength, resolved.truncatedSuffix),
  };
  seen.add(err);
  try {
    for (const [key, value] of Object.entries(err)) {
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      result[key] = truncateValue(value, resolved, seen);
    }
  } finally {
    seen.delete(err);
  }
  return result;
}

exports.DEFAULT_MAX_LENGTH = DEFAULT_MAX_LENGTH;
exports.DEFAULT_TRUNCATED_SUFFIX = DEFAULT_TRUNCATED_SUFFIX;
exports.resolveOptions = resolveOptions;
exports.truncateString = truncateString;
exports.truncateStrings = truncateStrings;
exports.truncateError = truncateError;
