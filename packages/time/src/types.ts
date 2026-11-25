/** Wall-clock read surface used across Sub Rosa services and UI. */
export interface Clock {
  /** Current epoch milliseconds. */
  nowMs(): number;
  /** Current epoch seconds (floor of nowMs / 1000). */
  nowSeconds(): number;
  /** ISO-8601 string for the given instant (defaults to now). */
  toISOString(atMs?: number): string;
}

/** Opaque handle returned by scheduler timer APIs. */
export interface TimerHandle {
  readonly id: number;
}

/** Sleep, timeout, and interval scheduling with explicit cancellation. */
export interface Scheduler {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clear(handle: TimerHandle): void;
  /** Cancel every pending timer owned by this scheduler (shutdown / cleanup). */
  cancelAll(): void;
}

export interface TimeContext {
  clock: Clock;
  scheduler: Scheduler;
}

export type PartialTimeContext = {
  clock?: Clock;
  scheduler?: Scheduler;
};

/** Merge partial overrides onto a base time context. */
export function resolveTimeContext(
  base: TimeContext,
  overrides?: PartialTimeContext,
): TimeContext {
  return {
    clock: overrides?.clock ?? base.clock,
    scheduler: overrides?.scheduler ?? base.scheduler,
  };
}
