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

/** Format a duration in seconds without countdown-specific publication copy. */
export function formatDuration(seconds: number): string {
  const duration = Math.max(0, seconds);
  const h = Math.floor(duration / 3600);
  const m = Math.floor((duration % 3600) / 60);
  const s = duration % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
