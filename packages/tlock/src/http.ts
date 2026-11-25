// Copyright (c) 2026 Sub Rosa contributors
// Bounded HTTP access for the public Drand beacon endpoint.
//
// Drand responses are small (a quicknet beacon is a few hundred bytes), but the
// endpoint is public and a proxy or replica can return an arbitrarily large
// body. Reading such a body in full before JSON-parsing it would let a remote
// peer exhaust memory in the sealer, keeper, or browser. Every Quicknet
// response therefore goes through `fetchDrandJson`, which enforces a fixed byte
// ceiling *while streaming* and aborts before the body is parsed.

/** Maximum bytes accepted from any Quicknet HTTP response (64 KiB). */
export const MAX_DRAND_RESPONSE_BYTES = 64 * 1024;

/** The subset of `fetch` used by the Drand client; injectable for tests. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Thrown when a Drand response exceeds {@link MAX_DRAND_RESPONSE_BYTES}. */
export class DrandResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number, readonly receivedBytes?: number) {
    const received =
      receivedBytes === undefined ? "" : ` (received at least ${receivedBytes} bytes)`;
    super(`drand response exceeds the ${maxBytes}-byte limit${received}`);
    this.name = "DrandResponseTooLargeError";
  }
}

/**
 * Fetch a JSON document from `url`, rejecting any response whose body exceeds
 * `maxBytes`. The limit is checked against `Content-Length` when present and
 * enforced on the streamed body otherwise, so an oversized response is aborted
 * before `JSON.parse` ever runs.
 */
export async function fetchDrandJson<T = unknown>(
  url: string,
  fetchImpl: FetchLike = fetch,
  maxBytes: number = MAX_DRAND_RESPONSE_BYTES,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "sub-rosa-tlock" },
  });

  if (!response.ok) {
    throw new Error(`drand request failed: HTTP ${response.status}`);
  }

  const declared = parseContentLength(response.headers.get("content-length"));
  if (declared !== undefined && declared > maxBytes) {
    await discardBody(response);
    throw new DrandResponseTooLargeError(maxBytes, declared);
  }

  const text = await readBoundedText(response, maxBytes);
  return JSON.parse(text) as T;
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response may already be consumed or not cancellable; the size error
    // is the actionable failure, so cancellation problems are ignored.
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new DrandResponseTooLargeError(maxBytes, bytes.byteLength);
    }
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new DrandResponseTooLargeError(maxBytes, total);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
