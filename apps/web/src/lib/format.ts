// Copyright (c) 2026 Sub Rosa contributors
export function shortAddr(g: string, n = 6): string {
  if (g.length <= n * 2 + 3) return g;
  return `${g.slice(0, n)}…${g.slice(-n)}`;
}

export function usdc(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortHash(hex: string, n = 10): string {
  if (hex.length <= n * 2 + 1) return hex;
  return `${hex.slice(0, n)}…${hex.slice(-n)}`;
}

export function phaseIcon(status: "done" | "active" | "pending"): string {
  if (status === "done") return "✓";
  if (status === "active") return "●";
  return "○";
}
