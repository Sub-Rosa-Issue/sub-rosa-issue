// Copyright (c) 2026 Sub Rosa contributors
/**
 * Truncation helpers for structured diagnostics.
 *
 * The implementation lives in `@sub-rosa/logging` so the shared logger applies
 * the same limit where log fields are actually serialized; this module keeps
 * the SDK-facing entry point stable.
 *
 * A string is truncated only when it is strictly longer than `maxLength`. The
 * retained prefix is at most `maxLength` characters and the marker records that
 * content was dropped. The discarded tail is never copied into the result.
 */
export {
  DEFAULT_MAX_LENGTH,
  DEFAULT_TRUNCATED_SUFFIX,
  truncateError,
  truncateStrings,
  type TruncateOptions,
} from "@sub-rosa/logging";
