import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GROUPS = [
  {
    label: "Receipt fixtures",
    dir: "services/receipt-cli/src/fixtures",
    perFileBytes: 10_240,
    totalBytes: 51_200,
    include: /\.json$/,
  },
  {
    label: "Contract test snapshots",
    dir: "contracts/round/test_snapshots/test",
    perFileBytes: 262_144,
    totalBytes: 5_242_880,
    include: /\.json$/,
  },
  {
    label: "Demo trace outputs",
    dir: "apps/web/src/demo",
    perFileBytes: 20_480,
    totalBytes: 51_200,
    include: /\.(ts|js)$/,
  },
];

function walk(dir, include) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(full, include));
      } else if (!include || include.test(entry.name)) {
        files.push(full);
      }
    }
  } catch {
    // directory does not exist
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function checkGroup(group) {
  const files = walk(group.dir, group.include).map((f) => {
    const bytes = statSync(f).size;
    return { path: relative(process.cwd(), f), bytes, ok: bytes <= group.perFileBytes };
  });

  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const totalOk = totalBytes <= group.totalBytes;
  const allFilesOk = files.every((f) => f.ok);

  return { label: group.label, files, totalBytes, totalOk, ok: allFilesOk && totalOk };
}

function main() {
  let allPassed = true;

  for (const group of GROUPS) {
    const result = checkGroup(group);

    if (result.files.length === 0) {
      console.log(`  [SKIP] ${group.label} — directory not found or empty`);
      continue;
    }

    const perFileLimit = formatBytes(group.perFileBytes);
    const totalLimit = formatBytes(group.totalBytes);

    console.log(`\n${result.label}  (per-file ≤ ${perFileLimit}, total ≤ ${totalLimit})`);
    console.log("-".repeat(60));

    for (const f of result.files) {
      const tag = f.ok ? "PASS" : "FAIL";
      const size = formatBytes(f.bytes);
      if (f.ok) {
        console.log(`  [${tag}]  ${size.padStart(10)}  ${f.path}`);
      } else {
        console.log(`  [${tag}]  ${size.padStart(10)}  ${f.path}  (limit ${perFileLimit})`);
        allPassed = false;
      }
    }

    const totalTag = result.totalOk ? "PASS" : "FAIL";
    const groupTag = result.ok ? "PASS" : "FAIL";
    const totalSize = formatBytes(result.totalBytes);
    console.log(`  [${totalTag}]  ${totalSize.padStart(10)}  total  (limit ${totalLimit})`);
    console.log(`  Group: [${groupTag}]`);
  }

  console.log("");
  if (allPassed) {
    console.log("All fixture size budgets are within limits.");
    process.exit(0);
  } else {
    console.log("Some fixture size budgets are exceeded.");
    console.log("To update budgets, edit GROUPS in scripts/check-fixture-sizes.mjs.");
    process.exit(1);
  }
}

main();
