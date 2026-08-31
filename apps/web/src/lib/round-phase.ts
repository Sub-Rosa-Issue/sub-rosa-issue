// Copyright (c) 2026 Sub Rosa contributors
import type { RoundStatus } from "../dashboard/types";

export type RoundPhase = "Open" | "Reveal" | "Settled";

export interface ClassifyRoundPhaseInput {
  status: RoundStatus;
  drandPublished: boolean;
}

export function classifyRoundPhase({
  status,
  drandPublished,
}: ClassifyRoundPhaseInput): RoundPhase {
  if (status === "Settled" || status === "Voided") return "Settled";
  if (status === "Revealing" || status === "Cleared" || drandPublished) {
    return "Reveal";
  }
  return "Open";
}
