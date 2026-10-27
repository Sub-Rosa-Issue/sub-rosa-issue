#!/usr/bin/env node
import { normalizeError } from "../packages/logging/src/errors.cjs";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from "../packages/logging/src/index.cjs";
const diagnostics = createLogger("scripts.check-snapshots");
// check-snapshots.mjs
//
// CI guard for Issue #120 & #521 — contract snapshot & dashboard evidence check.
//
// Verifies that:
//   1. Every required contract test snapshot category is present in
//      contracts/round/test_snapshots/test and every committed .json snapshot
//      parses as a valid Soroban snapshot object (generators, auth, ledger, events).
//   2. Committed dashboard demo evidence (apps/web/src/demo/demo-trace.generated.ts
//      and apps/web/src/demo/demo-trace.checksum.ts) is present, matches the
//      canonical lifecycle milestone checksum, includes all required lifecycle
//      phases/bidders/agents/keeper/settlement/auditor blobs, and contains no
//      secret seeds.
//
// Usage (from repo root):
//   node scripts/check-snapshots.mjs
//   pnpm snapshot:check
//
// Exit codes:
//   0  all required contract snapshots and dashboard evidence are healthy
//   1  missing, corrupted, or stale contract snapshot or dashboard evidence

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SNAPSHOT_DIR = resolve(
  __dirname,
  "../contracts/round/test_snapshots/test",
);
export const DEFAULT_DEMO_TRACE_PATH = resolve(
  __dirname,
  "../apps/web/src/demo/demo-trace.generated.ts",
);
export const DEFAULT_CHECKSUM_PATH = resolve(
  __dirname,
  "../apps/web/src/demo/demo-trace.checksum.ts",
);

export const REQUIRED_CATEGORIES = [
  // ── Create ──────────────────────────────────────────────────────────────
  "create_round_happy_path",
  "create_round_rejects_commit_after_reveal",
  "create_round_rejects_deadline_in_past",

  // ── Commit ───────────────────────────────────────────────────────────────
  "commit_locks_escrow",
  "commit_after_deadline_rejected",
  "commit_zero_escrow_rejected",
  "commit_on_settled_round_rejected",
  "commit_overwrite_before_close_refunds_prior_escrow",
  "overwrite_to_larger_escrow_conserves_tokens",
  "repeated_overwrites_escrow_conservation",

  // ── Reveal ───────────────────────────────────────────────────────────────
  "duplicate_reveal_rejected",
  "reveal_hash_mismatch_invalidates_bid",
  "reveal_wrong_nonce_rejected",
  "reveal_on_settled_round_rejected",
  "late_reveal_rejected_after_window_even_with_seal_present",
  "open_reveal_extends_seal_through_reveal_window",
  "open_reveal_on_settled_round_rejected",
  "missing_reveal_bid_is_skipped_during_clear",
  "no_valid_bids_after_reveal_window",

  // ── Settle ───────────────────────────────────────────────────────────────
  "double_settle_rejected",
  "settle_exact_payouts_table",
  "settled_round_persistent_state_survives_seal_expiry",
  "contract_balance_zero_after_settle",
  "clear_and_settle_work_after_seal_expiry",

  // ── Void ─────────────────────────────────────────────────────────────────
  "double_void_rejected",
  "void_before_grace_rejected",
  "void_after_grace_refunds_all",
  "voided_round_refunds_survive_seal_expiry",
  "contract_balance_zero_after_void",

  // ── Pagination ───────────────────────────────────────────────────────────
  "get_bidders_page_empty",
  "get_bidders_page_exact",
  "get_bidders_page_partial",
  "get_bidders_page_final",
  "get_bidders_page_multi",
  "get_bidders_page_cursor_at_total",
  "get_bidders_page_cursor_beyond_total",
  "get_bidders_page_rejects_limit_zero",
  "get_bidders_page_rejects_limit_over_max",
  "get_bidders_page_preserves_order",
  "get_bidders_returns_ordered_index",
  "get_bidders_still_returns_full_list",

  // ── Drand / lifecycle ────────────────────────────────────────────────────
  "full_lifecycle_real_drand_signature",
  "active_round_seal_ttl_covers_reveal_window",
  "observer_reads_round_and_bid_state_after_lifecycle_completion",
  "token_conservation_full_lifecycle",

  // ── Clearing rules ───────────────────────────────────────────────────────
  "highest_bid_table_driven",
  "highest_bid_tie_is_deterministic_first_inserter_wins",
  "lowest_bid_table_driven",
  "lowest_bid_tie_is_deterministic_first_inserter_wins",
  "seeded_case_42_highest_bid_reproducible",
  "seeded_case_7_lowest_bid_reproducible",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectJsonFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(full));
    } else if (entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

export function validateSnapshotPayload(rawText, label) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return `${label}: invalid JSON (${normalizeError(err).message})`;
  }
  if (!isRecord(parsed)) {
    return `${label}: snapshot root must be a JSON object`;
  }
  if (!isRecord(parsed.generators)) {
    return `${label}: missing or invalid 'generators' object`;
  }
  if (!Array.isArray(parsed.auth)) {
    return `${label}: missing or invalid 'auth' array`;
  }
  if (!isRecord(parsed.ledger)) {
    return `${label}: missing or invalid 'ledger' object`;
  }
  if (!Array.isArray(parsed.events)) {
    return `${label}: missing or invalid 'events' array`;
  }
  return null;
}

export function checkContractSnapshots(snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  let topEntries;
  try {
    topEntries = readdirSync(snapshotDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      dirError: normalizeError(err).message,
      filesFound: 0,
      categoriesChecked: REQUIRED_CATEGORIES.length,
      missingCategories: [],
      invalidSnapshots: [],
    };
  }

  const topFiles = topEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);

  const presentCategories = new Set(
    topFiles.map((f) => f.replace(/\.\d+\.json$/, "")),
  );

  const missingCategories = REQUIRED_CATEGORIES.filter(
    (cat) => !presentCategories.has(cat),
  );

  const allJsonFiles = collectJsonFiles(snapshotDir);
  const invalidSnapshots = [];
  for (const fullPath of allJsonFiles) {
    const relLabel = relative(snapshotDir, fullPath).replaceAll("\\", "/");
    try {
      const content = readFileSync(fullPath, "utf8");
      const issue = validateSnapshotPayload(content, relLabel);
      if (issue) invalidSnapshots.push(issue);
    } catch (err) {
      invalidSnapshots.push(
        `${relLabel}: unreadable snapshot (${normalizeError(err).message})`,
      );
    }
  }

  return {
    ok: missingCategories.length === 0 && invalidSnapshots.length === 0,
    dirError: null,
    filesFound: topFiles.length,
    categoriesChecked: REQUIRED_CATEGORIES.length,
    missingCategories,
    invalidSnapshots,
  };
}

export function parseDemoTraceSource(source) {
  const match = source.match(
    /export\s+const\s+DEMO_TRACE\s*=\s*(\{[\s\S]*\})\s*as\s+const\s*;/,
  );
  if (!match) {
    throw new Error("Could not locate `export const DEMO_TRACE = { ... } as const;`");
  }
  return JSON.parse(match[1]);
}

export function parseChecksumSource(source) {
  const milestonesMatch = source.match(
    /export\s+const\s+REQUIRED_MILESTONES\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/,
  );
  if (!milestonesMatch) {
    throw new Error("Could not locate `REQUIRED_MILESTONES` in checksum file");
  }
  const milestones = [...milestonesMatch[1].matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );
  const checksumMatch = source.match(
    /export\s+const\s+LIFE_CYCLE_PHASES_CHECKSUM\s*=\s*"([0-9a-f]{64})"\s*;/,
  );
  if (!checksumMatch) {
    throw new Error(
      "Could not locate `LIFE_CYCLE_PHASES_CHECKSUM` in checksum file",
    );
  }
  return {
    requiredMilestones: milestones,
    expectedChecksum: checksumMatch[1],
  };
}

export function checkDashboardEvidence({
  demoTracePath = DEFAULT_DEMO_TRACE_PATH,
  checksumPath = DEFAULT_CHECKSUM_PATH,
} = {}) {
  const issues = [];
  let traceSource;
  let checksumSource;
  try {
    traceSource = readFileSync(demoTracePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      issues: [
        `Cannot read demo trace (${demoTracePath}): ${normalizeError(err).message}`,
      ],
    };
  }
  try {
    checksumSource = readFileSync(checksumPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      issues: [
        `Cannot read demo trace checksum (${checksumPath}): ${normalizeError(err).message}`,
      ],
    };
  }

  let trace;
  let checksumConfig;
  try {
    trace = parseDemoTraceSource(traceSource);
  } catch (err) {
    return {
      ok: false,
      issues: [`Invalid demo trace file: ${normalizeError(err).message}`],
    };
  }
  try {
    checksumConfig = parseChecksumSource(checksumSource);
  } catch (err) {
    return {
      ok: false,
      issues: [`Invalid demo checksum file: ${normalizeError(err).message}`],
    };
  }

  const canonical = [...checksumConfig.requiredMilestones].sort().join("|");
  const computedChecksum = createHash("sha256").update(canonical).digest("hex");
  if (computedChecksum !== checksumConfig.expectedChecksum) {
    issues.push(
      `LIFE_CYCLE_PHASES_CHECKSUM mismatch: expected ${checksumConfig.expectedChecksum}, computed ${computedChecksum}`,
    );
  }

  if (/\bS[A-Z2-7]{55}\b/.test(JSON.stringify(trace))) {
    issues.push("DEMO_TRACE must not contain a Stellar secret seed");
  }

  if (
    !isRecord(trace.meta) ||
    typeof trace.meta.contractId !== "string" ||
    trace.meta.contractId.trim() === "" ||
    typeof trace.meta.recordedAt !== "string" ||
    trace.meta.recordedAt.trim() === "" ||
    typeof trace.meta.roundStatus !== "string" ||
    trace.meta.roundStatus.trim() === ""
  ) {
    issues.push("DEMO_TRACE.meta is missing required contractId, recordedAt, or roundStatus");
  }

  if (!Array.isArray(trace.lifecycle) || trace.lifecycle.length === 0) {
    issues.push("DEMO_TRACE.lifecycle must be a non-empty array");
  } else {
    const phases = trace.lifecycle
      .map((item) => (isRecord(item) && typeof item.phase === "string" ? item.phase : null))
      .filter(Boolean);
    const missingMilestones = checksumConfig.requiredMilestones.filter(
      (m) => !phases.includes(m),
    );
    if (missingMilestones.length > 0) {
      issues.push(
        `DEMO_TRACE.lifecycle is missing required milestones: ${missingMilestones.join(", ")}`,
      );
    }
    const settleCount = phases.filter((p) => p === "settle").length;
    if (settleCount !== 1 || phases[phases.length - 1] !== "settle") {
      issues.push("DEMO_TRACE.lifecycle must end with a single settle phase");
    }
  }

  const bidderLabels =
    Array.isArray(trace.bidders) && trace.bidders.length > 0
      ? trace.bidders
          .map((b) => (isRecord(b) && typeof b.label === "string" ? b.label.trim() : ""))
          .filter(Boolean)
      : [];
  if (bidderLabels.length === 0) {
    issues.push("DEMO_TRACE.bidders must contain at least one bidder");
  }

  const agentNames =
    Array.isArray(trace.agents) && trace.agents.length > 0
      ? trace.agents
          .map((a) => (isRecord(a) && typeof a.name === "string" ? a.name.trim() : ""))
          .filter(Boolean)
      : [];
  for (const label of bidderLabels) {
    if (!agentNames.includes(label)) {
      issues.push(`DEMO_TRACE bidder "${label}" is missing a matching agent record`);
    }
  }

  if (!isRecord(trace.settlement)) {
    issues.push("DEMO_TRACE.settlement receipt section is missing");
  }

  if (!isRecord(trace.auditor) || !isRecord(trace.auditor.blobs)) {
    issues.push("DEMO_TRACE.auditor.blobs is missing");
  } else {
    for (const label of bidderLabels) {
      const blob = trace.auditor.blobs[label];
      if (typeof blob !== "string" || blob.trim() === "") {
        issues.push(`DEMO_TRACE.auditor.blobs.${label} must be a non-empty string`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function checkSnapshots({
  snapshotDir = DEFAULT_SNAPSHOT_DIR,
  demoTracePath = DEFAULT_DEMO_TRACE_PATH,
  checksumPath = DEFAULT_CHECKSUM_PATH,
} = {}) {
  const contract = checkContractSnapshots(snapshotDir);
  const dashboard = checkDashboardEvidence({ demoTracePath, checksumPath });
  return {
    ok: contract.ok && dashboard.ok,
    contract,
    dashboard,
  };
}

function main() {
  const snapshotDir = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_SNAPSHOT_DIR;
  const demoTracePath = process.argv[3]
    ? resolve(process.cwd(), process.argv[3])
    : DEFAULT_DEMO_TRACE_PATH;
  const checksumPath = process.argv[4]
    ? resolve(process.cwd(), process.argv[4])
    : DEFAULT_CHECKSUM_PATH;

  const { ok, contract, dashboard } = checkSnapshots({
    snapshotDir,
    demoTracePath,
    checksumPath,
  });

  if (contract.dirError) {
    diagnostics.error(
      "cannot-read-snapshot-directory",
      `\n✗ Cannot read snapshot directory: ${snapshotDir}`,
    );
    diagnostics.error("progress", `  ${contract.dirError}`);
    process.exit(1);
  }

  diagnostics.info("contract-snapshot-inventory", "\nContract snapshot inventory");
  diagnostics.info("directory", `  Directory : ${snapshotDir}`);
  diagnostics.info("files-found", `  Files found  : ${contract.filesFound}`);
  diagnostics.info(
    "categories-checked",
    `  Categories checked : ${contract.categoriesChecked}`,
  );

  if (contract.missingCategories.length > 0) {
    diagnostics.error(
      "progress-2",
      `\n✗ ${contract.missingCategories.length} required snapshot category/categories missing:\n`,
    );
    for (const cat of contract.missingCategories) {
      diagnostics.error("progress-3", `    - ${cat}`);
    }
    diagnostics.error(
      "regenerate-snapshots-with-cargo-test-p-sub-rosa-round",
      "\n  Regenerate snapshots with: cargo test -p sub-rosa-round\n",
    );
  }

  if (contract.invalidSnapshots.length > 0) {
    diagnostics.error(
      "invalid-snapshot-payloads",
      `\n✗ ${contract.invalidSnapshots.length} snapshot file(s) failed payload validation:\n`,
    );
    for (const issue of contract.invalidSnapshots) {
      diagnostics.error("invalid-snapshot-detail", `    - ${issue}`);
    }
  }

  if (!dashboard.ok) {
    diagnostics.error(
      "stale-dashboard-evidence",
      `\n✗ Dashboard demo evidence failed health check:\n`,
    );
    for (const issue of dashboard.issues) {
      diagnostics.error("stale-dashboard-detail", `    - ${issue}`);
    }
  }

  if (ok) {
    diagnostics.info(
      "all",
      `\n✓ All ${contract.categoriesChecked} required snapshot categories and dashboard evidence are healthy.\n`,
    );
    process.exit(0);
  }

  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
