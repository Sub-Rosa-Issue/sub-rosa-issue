// Copyright (c) 2026 Sub Rosa contributors
export interface AttackStep {
  label: string;
  ok: boolean;
  detail: string;
}

export interface CapDemoResult {
  id: string;
  title: string;
  layer: "agent (off-chain)" | "contract (on-chain)";
  expected: "reject" | "clamp" | "invalid bid";
  outcome: string;
  pass: boolean;
}
