// Checksum guard for the canonical demo trace.
// Prevents accidental edits to demo-trace.generated.ts that break the public web demo.
//
// Required lifecycle milestones must all be present in the trace lifecycle array.
// The checksum is SHA-256 of the canonical milestone phase names (sorted, pipe-joined).
// The settlement section serves as the "receipt" milestone.
//
// To update after intentional lifecycle changes:
//   1. Edit REQUIRED_MILESTONES below
//   2. Compute the new checksum:
//      echo -n "$(IFS=\|; echo "${REQUIRED_MILESTONES[*]}" | tr ' ' '\n' | sort | tr '\n' '|' | sed 's/|$//')" | shasum -a 256
//   3. Update LIFE_CYCLE_PHASES_CHECKSUM to the new hex digest

import { createHash } from "node:crypto";

export const REQUIRED_MILESTONES = [
  "create_round",
  "commit",
  "open_reveal",
  "reveal_all",
  "settle",
] as const;

export const LIFE_CYCLE_PHASES_CHECKSUM =
  "c495891ef6c46f0031211379776c040c3241665764129eef0dda1e3e7be60993";

export function computeMilestoneChecksum(): string {
  const canonical = [...REQUIRED_MILESTONES].sort().join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyMilestones(
  lifecyclePhases: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  const missing = REQUIRED_MILESTONES.filter(
    (m) => !lifecyclePhases.includes(m),
  );
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}
