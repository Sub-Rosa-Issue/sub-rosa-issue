import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  PILOT_EXPECTED_RANKING,
  PILOT_FIXTURE_PROGRAM,
} from "./fixtures.js";
import {
  PilotFixtureError,
  validatePilotFixture,
} from "./fixture-schema.js";
import { loadPilotFixture } from "./load-pilot-fixture.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

const readFixtureJson = (fileName: string): unknown =>
  JSON.parse(readFileSync(resolve(fixturesDir, fileName), "utf8"));

function captureError(fn: () => void): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`expected an Error, got ${typeof e}: ${String(e)}`);
  }
  throw new Error("expected function to throw, but it returned normally");
}

describe("pilot fixture schema — valid", () => {
  test("pilot-program.json validates and matches in-code fixture program", () => {
    const fixture = loadPilotFixture("pilot-program.json");

    assert.equal(fixture.programId, PILOT_FIXTURE_PROGRAM.id);
    assert.equal(fixture.title, PILOT_FIXTURE_PROGRAM.title);
    assert.equal(fixture.judges, PILOT_FIXTURE_PROGRAM.judges.length);
    assert.equal(fixture.projects, PILOT_FIXTURE_PROGRAM.projects.length);
    assert.deepEqual(
      fixture.criteria,
      PILOT_FIXTURE_PROGRAM.criteria.map((c) => c.id),
    );
    assert.deepEqual(fixture.expectedRanking, [...PILOT_EXPECTED_RANKING]);
    assert.ok(typeof fixture.note === "string" && fixture.note.length > 0);
  });
});

describe("pilot fixture schema — invalid", () => {
  test("missing-fields.json fails fast naming programId", () => {
    const raw = readFixtureJson("missing-fields.json");
    const err = captureError(() => validatePilotFixture(raw));
    assert.ok(err instanceof PilotFixtureError);
    assert.equal(err.field, "programId");
    assert.match(err.message, /programId: must be a non-empty string/);
  });

  test("wrong-types.json fails fast naming programId type", () => {
    const raw = readFixtureJson("wrong-types.json");
    const err = captureError(() => validatePilotFixture(raw));
    assert.ok(err instanceof PilotFixtureError);
    assert.equal(err.field, "programId");
    assert.match(err.message, /programId: must be a non-empty string, got object/);
  });
});
