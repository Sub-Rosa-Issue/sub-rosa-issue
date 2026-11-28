// Copyright (c) 2026 Sub Rosa contributors
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Maximum receipt input size in bytes for both files and stdin (1 MiB). */
export const MAX_RECEIPT_INPUT_BYTES = 1_048_576;

const READ_CHUNK_BYTES = 64 * 1024;

export class ReceiptInputTooLargeError extends Error {
  readonly name = "ReceiptInputTooLargeError";
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Receipt input exceeds maximum size of ${limitBytes} bytes`);
    this.limitBytes = limitBytes;
  }
}

/**
 * Read a receipt file without buffering past `maxBytes`.
 * Regular files larger than `maxBytes` are rejected via `fstatSync` before any
 * payload bytes are read; non-regular files (e.g. FIFOs) are bounded by chunk.
 */
export function readCappedFile(
  filePath: string,
  maxBytes: number = MAX_RECEIPT_INPUT_BYTES,
): string {
  const fd = openSync(filePath, "r");
  try {
    const stat = fstatSync(fd);
    if (stat.isFile() && stat.size > maxBytes) {
      throw new ReceiptInputTooLargeError(maxBytes);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
    while (true) {
      const bytesRead = readSync(fd, buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new ReceiptInputTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Read receipt input from a stream (default `process.stdin`) without buffering
 * past `maxBytes`.
 */
export async function readCappedStdin(
  maxBytes: number = MAX_RECEIPT_INPUT_BYTES,
  stream: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
      throw new ReceiptInputTooLargeError(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total).toString("utf-8");
}

/** Read receipt JSON from a file path or `-` (stdin), capped at `maxBytes`. */
export async function readCappedReceiptInput(
  source: string,
  maxBytes: number = MAX_RECEIPT_INPUT_BYTES,
): Promise<string> {
  if (source === "-") {
    return readCappedStdin(maxBytes);
  }
  return readCappedFile(source, maxBytes);
}
