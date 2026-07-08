export type BadgeState = "loading" | "empty" | "error" | "stale" | "found";

export interface RoundStatusInfo {
  state: BadgeState;
  tag: string | null;
  message: string;
}

export interface RoundStatusInput {
  live: unknown;
  error: string | null;
  configured: boolean;
  stale: boolean;
}

export function getRoundStatusInfo(input: RoundStatusInput): RoundStatusInfo {
  const { live, error, configured, stale } = input;

  if (error) {
    return { state: "error", tag: null, message: error };
  }

  if (configured && live === null) {
    return { state: "loading", tag: null, message: "Fetching round status…" };
  }

  if (live === null) {
    return { state: "empty", tag: null, message: "No live round data" };
  }

  const tag = (
    live as { round?: { status?: { tag?: string } } } | null
  )?.round?.status?.tag ?? null;

  if (stale) {
    return { state: "stale", tag, message: "Live data may be stale" };
  }

  return { state: "found", tag, message: tag ?? "Round exists" };
}
