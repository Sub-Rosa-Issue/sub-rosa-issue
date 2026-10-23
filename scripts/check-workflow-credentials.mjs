// Copyright (c) 2026 Sub Rosa contributors
// Repository-wide assertion: every actions/checkout step in .github/workflows
// must set persist-credentials: false so the GitHub token is not left in the
// local Git credential configuration after the job finishes.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, "..");

/**
 * Find every actions/checkout step and verify persist-credentials: false
 * is present in its with: block. Returns an array of violations.
 */
export function findViolations(filePath, repoRoot) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const checkoutMatch = line.match(/^\s*-\s*uses:\s*actions\/checkout/);
    if (!checkoutMatch) continue;

    const stepIndent = line.match(/^(\s*)/)[1];

    let foundPersist = false;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      // A new step at the same or lower indentation ends this step block
      if (/^\s*-\s/.test(next) && next.match(/^(\s*)/)[1].length <= stepIndent.length) {
        break;
      }
      // A top-level or lower-indented non-empty line ends this step block
      if (next.trim() !== "" && next.match(/^(\s*)/)[1].length < stepIndent.length) {
        break;
      }
      if (/persist-credentials:\s*false/.test(next)) {
        foundPersist = true;
        break;
      }
    }

    if (!foundPersist) {
      violations.push({
        file: relative(repoRoot, filePath),
        line: i + 1,
      });
    }
  }

  return violations;
}

export function checkRepo(repoRoot) {
  const workflowsDir = join(repoRoot, ".github", "workflows");
  if (!existsSync(workflowsDir)) {
    return { files: [], violations: [] };
  }

  const files = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => join(workflowsDir, f));

  const allViolations = [];
  for (const file of files) {
    allViolations.push(...findViolations(file, repoRoot));
  }

  return { files, violations: allViolations };
}

function main() {
  const repoRoot = process.argv[2] || DEFAULT_REPO_ROOT;
  const { files, violations } = checkRepo(repoRoot);

  if (violations.length > 0) {
    for (const v of violations) {
      process.stdout.write(`${v.file}:${v.line}: actions/checkout without persist-credentials: false\n`);
    }
    process.stdout.write(
      `\nFound ${violations.length} checkout step(s) missing persist-credentials: false.\n` +
        "Read-only workflows must not leave Git credentials on the runner. Add:\n" +
        "  with:\n" +
        "    persist-credentials: false\n"
    );
    process.exit(1);
  }

  process.stdout.write(
    `All ${files.length} workflow file(s) have persist-credentials: false on every checkout step.\n`
  );
  process.exit(0);
}

main();
