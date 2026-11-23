import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregateCoverage,
  aggregateWorkspaceLines,
  countSourceLines,
  formatCoverageSummaryJson,
  formatCoverageSummaryMarkdown,
  listSourceFiles,
  parseLcov,
  writeCoverageSummary,
} from "./run-ts-coverage.mjs";

describe("parseLcov", () => {
  it("reads LH/LF totals per source file", () => {
    const lcov = [
      "TN:",
      "SF:src/a.ts",
      "LH:8",
      "LF:10",
      "end_of_record",
      "SF:src/b.ts",
      "LH:2",
      "LF:2",
      "end_of_record",
      "",
    ].join("\n");
    const files = parseLcov(lcov);
    assert.deepEqual(files.get("src/a.ts"), { covered: 8, total: 10 });
    assert.deepEqual(files.get("src/b.ts"), { covered: 2, total: 2 });
  });
});

describe("countSourceLines", () => {
  it("ignores blanks and comment-only lines", () => {
    const source = [
      "// header",
      "",
      "export const x = 1;",
      "  /* block */",
      "export function f() {",
      "  return x;",
      "}",
    ].join("\n");
    assert.equal(countSourceLines(source), 4);
  });
});

describe("aggregateWorkspaceLines", () => {
  it("counts deliberately unexecuted source files as uncovered", () => {
    const lcovFiles = new Map([["src/used.ts", { covered: 10, total: 10 }]]);
    const sourceFiles = ["src/used.ts", "src/orphan.ts"];
    const sources = {
      "src/used.ts": "export const a = 1;\n",
      "src/orphan.ts":
        "export function neverCalled() {\n  return 42;\n}\nexport const dead = true;\n",
    };
    const totals = aggregateWorkspaceLines(
      lcovFiles,
      sourceFiles,
      (rel) => sources[rel],
    );
    // orphan has 4 source lines → covered stays 10, total becomes 14
    assert.equal(totals.covered, 10);
    assert.equal(totals.total, 14);
    assert.ok(totals.percent < 80);
  });
});

describe("aggregateCoverage", () => {
  it("weights by line counts instead of averaging percentages", () => {
    const rows = [
      { covered: 100, total: 100 }, // tiny 100%
      { covered: 50, total: 200 }, // large 25%
    ];
    const meanOfPercents = (100 + 25) / 2; // 62.5
    const weighted = aggregateCoverage(rows);
    assert.equal(weighted.covered, 150);
    assert.equal(weighted.total, 300);
    assert.equal(weighted.percent, 50);
    assert.notEqual(weighted.percent, meanOfPercents);
  });
});

describe("listSourceFiles", () => {
  it("lists source files and skips tests", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cov-list-"));
    try {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(join(tmp, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(tmp, "src", "a.test.ts"), "import './a.js';\n");
      writeFileSync(join(tmp, "src", "orphan.ts"), "export const orphan = true;\n");
      assert.deepEqual(listSourceFiles(join(tmp, "src")), ["a.ts", "orphan.ts"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("node version support", () => {
  it("runs on the repository's supported Node major (>=22)", () => {
    const major = Number(process.versions.node.split(".")[0]);
    assert.ok(major >= 22, `expected Node >=22, got ${process.version}`);
  });
});

describe("compact coverage summary artifact", () => {
  const sampleRows = [
    { workspace: "packages/sdk", covered: 80, total: 100, percent: 80 },
    { workspace: "services/keeper", covered: 70, total: 100, percent: 70 },
  ];
  const sampleAggregate = aggregateCoverage(sampleRows);

  it("formats compact Markdown and JSON summaries with weighted totals", () => {
    const md = formatCoverageSummaryMarkdown(sampleRows, sampleAggregate, 70);
    assert.match(md, /## TypeScript Coverage Summary/);
    assert.match(md, /- \*\*Status\*\*: PASS/);
    assert.match(md, /\| `packages\/sdk` \| 80\.00% \| 80\/100 \|/);
    assert.match(md, /\| \*\*Aggregate \(weighted\)\*\* \| \*\*75\.00%\*\* \| \*\*150\/200\*\* \|/);

    const json = formatCoverageSummaryJson(sampleRows, sampleAggregate, 70);
    assert.equal(json.passed, true);
    assert.equal(json.lineThresholdPercent, 70);
    assert.deepEqual(json.aggregate, { covered: 150, total: 200, percent: 75 });
    assert.equal(json.workspaces.length, 2);
  });

  it("writes coverage-summary.md, coverage-summary.json, and GITHUB_STEP_SUMMARY", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cov-summary-"));
    try {
      const outDir = join(tmp, "coverage");
      const stepSummaryPath = join(tmp, "step-summary.md");
      const result = writeCoverageSummary(sampleRows, sampleAggregate, 70, {
        outDir,
        stepSummaryPath,
      });

      const diskMd = readFileSync(result.mdPath, "utf8");
      const diskJson = JSON.parse(readFileSync(result.jsonPath, "utf8"));
      const stepMd = readFileSync(stepSummaryPath, "utf8");

      assert.match(diskMd, /TypeScript Coverage Summary/);
      assert.match(stepMd, /TypeScript Coverage Summary/);
      assert.equal(diskJson.aggregate.percent, 75);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
