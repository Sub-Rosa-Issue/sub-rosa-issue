// Stable, hand-curated schema fixtures for the appraisal API.
//
// Bundling these as JSON next to the source means an integrator can copy the
// `valid-request.json` shape directly into their agent, and our own test suite
// uses the same canonical inputs. Loading happens at module-evaluation time and
// is read-only — there is no fixture mutation in any test.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export interface FixtureEntry<T> {
  /** Absolute on-disk path. Useful when a test wants to print where the bad fixture came from. */
  path: string;
  /** Fixture file name (minus `.json`). Mirrors a section heading in the package README. */
  description: string;
  value: T;
}

const loadFixture = <T>(file: string): FixtureEntry<T> => {
  const path = resolve(here, file);
  return {
    path,
    description: file.replace(/\.json$/, ""),
    value: JSON.parse(readFileSync(path, "utf8")) as T,
  };
};

export const validRequest = loadFixture<Record<string, unknown>>("valid-request.json");
export const validResponse = loadFixture<Record<string, unknown>>("valid-response.json");
export const missingFields = loadFixture<Record<string, unknown>>("missing-fields.json");
export const wrongTypes = loadFixture<Record<string, unknown>>("wrong-types.json");
export const oversizedText = loadFixture<Record<string, unknown>>("oversized-text.json");
export const invalidScoreValues = loadFixture<Record<string, unknown>>(
  "invalid-score-values.json",
);

export const allFixtures = [
  validRequest,
  validResponse,
  missingFields,
  wrongTypes,
  oversizedText,
  invalidScoreValues,
] as const;
