// Copyright (c) 2026 Sub Rosa contributors
import type { IncomingMessage } from "node:http";

/** Stable error code for an appraisal body above the configured byte cap. */
export const APPRAISAL_BODY_TOO_LARGE = "payload_too_large";

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
