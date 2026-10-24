// Copyright (c) 2026 Sub Rosa contributors
import type { IncomingMessage } from "node:http";

/** Stable error code for an appraisal body above the configured byte cap. */
export const APPRAISAL_BODY_TOO_LARGE = "payload_too_large";

/** Stable error code when `POST /appraise` omits or uses a non-JSON `Content-Type`. */
export const APPRAISAL_UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";

export function appraisalUnsupportedMediaTypeBody(): {
  error: typeof APPRAISAL_UNSUPPORTED_MEDIA_TYPE;
  expected: "application/json";
} {
  return {
    error: APPRAISAL_UNSUPPORTED_MEDIA_TYPE,
    expected: "application/json",
  };
}

/**
 * Return true when `Content-Type` is `application/json`, allowing optional
 * media-type parameters such as `; charset=utf-8` (case-insensitively).
 */
export function isJsonContentType(
  headerValue: string | string[] | undefined,
): boolean {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const parts = raw.split(";").map((part) => part.trim());
  const mediaType = parts[0]?.toLowerCase() ?? "";
  if (mediaType !== "application/json") return false;
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i];
    if (!param) return false;
    const eqIdx = param.indexOf("=");
    if (eqIdx <= 0) return false;
    const name = param.slice(0, eqIdx).trim().toLowerCase();
    const rawVal = param.slice(eqIdx + 1).trim();
    const val = rawVal.replace(/^"(.*)"$/, "$1").trim().toLowerCase();
    if (!val) return false;
    if (name === "charset" && val !== "utf-8" && val !== "utf8") {
      return false;
    }
  }
  return true;
}

/**
 * Validate `Content-Type` on `POST /appraise`. Returns a stable 415 response
 * instruction when the media type is missing or not `application/json`.
 */
export function checkAppraisalContentType(
  req: Pick<IncomingMessage, "headers">,
): {
  status: 415;
  body: ReturnType<typeof appraisalUnsupportedMediaTypeBody>;
} | null {
  if (isJsonContentType(req.headers["content-type"])) {
    return null;
  }
  return {
    status: 415,
    body: appraisalUnsupportedMediaTypeBody(),
  };
}

export class AppraisalBodyTooLargeError extends Error {
  readonly name = "AppraisalBodyTooLargeError";
  readonly status = 413 as const;

  constructor(readonly limitBytes: number) {
    super("appraisal request body exceeds limit");
  }
}

export function appraisalBodyTooLargeBody(limitBytes: number): {
  error: typeof APPRAISAL_BODY_TOO_LARGE;
  limitBytes: number;
} {
  return { error: APPRAISAL_BODY_TOO_LARGE, limitBytes };
}

/**
 * Read a request body without buffering past `maxBytes` and without parsing JSON.
 * An over-limit `Content-Length` fails before any chunk is kept. A chunked body
 * fails on the chunk that crosses the cap. The socket is left open so the caller
 * can still write the 413 response.
 */
export function readCappedBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      req.pause();
      req.removeAllListeners("data");
      reject(new AppraisalBodyTooLargeError(maxBytes));
    };

    const declared = req.headers["content-length"];
    if (declared !== undefined) {
      const raw = Array.isArray(declared) ? declared[0] : declared;
      const length = Number(raw);
      if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
        fail();
        return;
      }
    }

    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > maxBytes) {
        fail();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/** Cap result for `POST /appraise`. Oversized bodies never reach `JSON.parse`. */
export async function takeAppraisalRequestBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  | { raw: Buffer }
  | { status: 413; body: ReturnType<typeof appraisalBodyTooLargeBody> }
> {
  try {
    const raw = await readCappedBody(req, maxBytes);
    return { raw };
  } catch (err) {
    if (err instanceof AppraisalBodyTooLargeError) {
      return { status: 413, body: appraisalBodyTooLargeBody(err.limitBytes) };
    }
    throw err;
  }
}
