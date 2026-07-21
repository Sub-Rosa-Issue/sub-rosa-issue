import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type PilotFixture,
  validatePilotFixture,
} from "./fixture-schema.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

export const PILOT_FIXTURE_PATH = resolve(fixturesDir, "pilot-program.json");

/**
 * Load a JSON fixture from `fixtures/` and validate it against the shared schema.
 * Fail-fast with {@link PilotFixtureError} when the shape is malformed.
 */
export function loadPilotFixture(
  fileName = "pilot-program.json",
): PilotFixture {
  const path = resolve(fixturesDir, fileName);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read pilot fixture at ${path}: ${detail}`, {
      cause: err,
    });
  }
  return validatePilotFixture(raw);
}
