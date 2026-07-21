/**
 * Shared schema for pilot catalog fixtures under `examples/grant-scoring/fixtures`.
 *
 * Validates the onboarding JSON shape early so malformed pilot data fails with a
 * clear field-level message instead of a confusing error deep in scoring.
 */

export interface PilotFixture {
  programId: string;
  title: string;
  /** Expected judge count for the pilot panel. */
  judges: number;
  /** Expected project count for the pilot program. */
  projects: number;
  /** Criterion ids (e.g. impact, feasibility, team). */
  criteria: string[];
  /** Project ids in expected final ranking order (highest first). */
  expectedRanking: string[];
  /** Optional operator note (docs / quick-start hint). */
  note?: string;
}

export class PilotFixtureError extends Error {
  readonly name = "PilotFixtureError";

  constructor(
    readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${field}: ${message}`, options);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new PilotFixtureError(
      field,
      `must be a non-empty string, got ${value === null ? "null" : typeof value}`,
    );
  }
  if (value.trim() === "") {
    throw new PilotFixtureError(field, "must be a non-empty string");
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PilotFixtureError(
      field,
      `must be a positive integer, got ${typeof value === "number" ? value : typeof value}`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new PilotFixtureError(
      field,
      `must be an array of non-empty strings, got ${value === null ? "null" : typeof value}`,
    );
  }
  if (value.length === 0) {
    throw new PilotFixtureError(field, "must be a non-empty array");
  }
  return value.map((entry, index) =>
    requireNonEmptyString(entry, `${field}[${index}]`),
  );
}

/**
 * Validate unknown JSON against the shared pilot fixture schema.
 * Throws {@link PilotFixtureError} with a clear `field: message` on failure.
 */
export function validatePilotFixture(input: unknown): PilotFixture {
  if (!isPlainObject(input)) {
    throw new PilotFixtureError(
      "(root)",
      "pilot fixture must be a non-null object",
    );
  }

  const programId = requireNonEmptyString(input.programId, "programId");
  const title = requireNonEmptyString(input.title, "title");
  const judges = requirePositiveInteger(input.judges, "judges");
  const projects = requirePositiveInteger(input.projects, "projects");
  const criteria = requireStringArray(input.criteria, "criteria");
  const expectedRanking = requireStringArray(
    input.expectedRanking,
    "expectedRanking",
  );

  if (expectedRanking.length !== projects) {
    throw new PilotFixtureError(
      "expectedRanking",
      `length (${expectedRanking.length}) must equal projects (${projects})`,
    );
  }

  const fixture: PilotFixture = {
    programId,
    title,
    judges,
    projects,
    criteria,
    expectedRanking,
  };

  if (input.note !== undefined) {
    fixture.note = requireNonEmptyString(input.note, "note");
  }

  return fixture;
}
