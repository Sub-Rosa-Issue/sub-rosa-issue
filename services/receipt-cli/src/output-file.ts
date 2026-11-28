// Copyright (c) 2026 Sub Rosa contributors
// Guarded output writing for the receipt CLI.
//
// A receipt is written to an exclusively created temporary file next to the
// destination and then renamed into place, so a failed or interrupted write
// never leaves a half-written receipt and never touches an existing file.

import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

/** Largest receipt the CLI will write to disk. */
export const MAX_OUTPUT_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB

/** How many name collisions to tolerate before giving up on creating a temp file. */
const TEMP_CREATE_ATTEMPTS = 32;

export interface WriteOutputOptions {
  /** Replace an existing non-empty output file instead of refusing it. */
  force?: boolean;
  /** Override the output size cap (bytes). */
  maxBytes?: number;
}

/**
 * Refuse an output path that already holds data. The check runs before any
 * temporary file is created, so an existing receipt is never truncated.
 */
function assertTargetWritable(filePath: string, force: boolean, maxBytes: number): void {
  let stats;
  try {
    stats = statSync(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }

  if (stats.isFile() && stats.size > maxBytes) {
    throw new Error(
      `Output file "${filePath}" exceeds maximum allowed size of ${maxBytes} bytes.`,
    );
  }
  if (stats.size > 0 && !force) {
    throw new Error(
      `Output file "${filePath}" exists and is not empty. Use --force to overwrite.`,
    );
  }
}

interface TempFile {
  path: string;
  fd: number;
}

/**
 * Create a fresh temporary file beside the destination with O_CREAT | O_EXCL
 * (`'wx'`). Exclusive creation means a name collision fails instead of
 * truncating whatever already occupies that name; collisions are retried with
 * a new name until one is created.
 */
function createTempFile(filePath: string): TempFile {
  const directory = dirname(filePath) || ".";
  const name = basename(filePath);

  for (let attempt = 0; attempt < TEMP_CREATE_ATTEMPTS; attempt++) {
    const suffix = randomBytes(6).toString("hex");
    const path = join(directory, `.${name}.tmp-${process.pid}-${suffix}`);
    try {
      const fd = openSync(path, "wx", 0o600);
      return { path, fd };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }

  throw new Error(
    `Could not create a temporary file for "${filePath}" after ${TEMP_CREATE_ATTEMPTS} attempts.`,
  );
}

/**
 * Write `data` to `filePath` through an exclusively created temporary file.
 *
 * The temporary file is removed on every failure path, including a failure to
 * flush or to rename it into place, and an existing destination is left exactly
 * as it was. `force` only permits replacing an already-present, non-empty
 * destination; it never allows a partial write to land there.
 */
export function writeOutputFile(
  filePath: string,
  data: string,
  options: WriteOutputOptions = {},
): void {
  const force = options.force ?? false;
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_FILE_SIZE;
  const payload = Buffer.from(data, "utf8");

  if (payload.byteLength > maxBytes) {
    throw new Error(`Refusing to write ${payload.byteLength} bytes; the limit is ${maxBytes} bytes.`);
  }

  assertTargetWritable(filePath, force, maxBytes);

  let temp: TempFile | undefined;
  let fdOpen = false;
  try {
    temp = createTempFile(filePath);
    fdOpen = true;

    // writeSync may perform a short write on a regular file; keep going until
    // the whole payload has landed.
    let written = 0;
    while (written < payload.byteLength) {
      written += writeSync(temp.fd, payload, written, payload.byteLength - written);
    }
    fsyncSync(temp.fd);
    closeSync(temp.fd);
    fdOpen = false;

    renameSync(temp.path, filePath);
    temp = undefined;
  } finally {
    if (temp) {
      if (fdOpen) {
        try { closeSync(temp.fd); } catch { /* fd already unusable */ }
      }
      try { unlinkSync(temp.path); } catch { /* temp already gone */ }
    }
  }
}
