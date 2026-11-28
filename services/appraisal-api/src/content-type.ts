// Copyright (c) 2026 Sub Rosa contributors

/** Stable error code for a `POST /appraise` with an unsupported media type. */
export const APPRAISAL_UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";

/** The only media type `POST /appraise` accepts. */
export const APPRAISAL_MEDIA_TYPE = "application/json";

/** Charsets the server can decode (bodies are read as UTF-8). */
const SUPPORTED_CHARSETS = new Set(["utf-8", "utf8"]);

/** Stable 415 body: callers can branch on `error` and read the expected type. */
export function appraisalUnsupportedMediaTypeBody(): {
  error: typeof APPRAISAL_UNSUPPORTED_MEDIA_TYPE;
  expected: typeof APPRAISAL_MEDIA_TYPE;
} {
  return { error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE, expected: APPRAISAL_MEDIA_TYPE };
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/**
 * True when a `Content-Type` header value is `application/json`, optionally with
 * parameters. The media type is matched case-insensitively and exactly, so
 * `application/jsonp`, `text/json` and `application/json-patch+json` are all
 * rejected. A `charset` parameter is allowed only when it is UTF-8, because the
 * body is decoded as UTF-8; any other charset would be silently mis-decoded.
 * A missing or empty header is not acceptable.
 */
export function isAppraisalJsonContentType(header: string | undefined): boolean {
  if (typeof header !== "string") return false;
  const [mediaType = "", ...params] = header.split(";");
  if (mediaType.trim().toLowerCase() !== APPRAISAL_MEDIA_TYPE) return false;

  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    const name = param.slice(0, eq).trim().toLowerCase();
    if (name !== "charset") continue;
    const value = unquote(param.slice(eq + 1).trim()).toLowerCase();
    if (!SUPPORTED_CHARSETS.has(value)) return false;
  }
  return true;
}
