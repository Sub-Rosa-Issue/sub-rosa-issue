import { FakeClock } from "./fake-clock.js";
import type { Scheduler, TimerHandle } from "./types.js";

type TaskKind = "timeout" | "interval" | "sleep";

interface ScheduledTask {
  id: number;
  dueMs: number;
  kind: TaskKind;
  callback?: () => void;
  intervalMs?: number;
  sleepResolve?: () => void;
  sleepReject?: (error: Error) => void;
}

/** Deterministic scheduler paired with a {@link FakeClock}. */
export class FakeScheduler implements Scheduler {
  readonly clock: FakeClock;
  #tasks = new Map<number, ScheduledTask>();
  #nextId = 1;

  constructor(clock: FakeClock) {
    this.clock = clock;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    const dueMs = this.clock.nowMs() + ms;
    return new Promise<void>((resolve, reject) => {
      const id = this.#nextId++;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        this.#tasks.delete(id);
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#tasks.set(id, {
        id,
        dueMs,
        kind: "sleep",
        sleepResolve: () => {
          cleanup();
          resolve();
        },
        sleepReject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.#nextId++;
    const handle: TimerHandle = { id };
    this.#tasks.set(id, {
      id,
      dueMs: this.clock.nowMs() + delayMs,
      kind: "timeout",
      callback,
    });
    return handle;
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    const id = this.#nextId++;
    const handle: TimerHandle = { id };
    this.#tasks.set(id, {
      id,
      dueMs: this.clock.nowMs() + intervalMs,
      kind: "interval",
      callback,
      intervalMs,
    });
    return handle;
  }

  clear(handle: TimerHandle): void {
    this.#tasks.delete(handle.id);
  }

  cancelAll(): void {
    for (const task of this.#tasks.values()) {
      if (task.kind === "sleep") {
        task.sleepReject?.(new Error("Scheduler cancelled"));
      }
    }
    this.#tasks.clear();
  }

  /** Advance fake time and run due work in deterministic order. */
  advance(ms: number): void {
    this.clock.advance(ms);
    this.runDue();
  }

  /** Jump to an absolute instant and run due work. */
  set(ms: number): void {
    this.clock.set(ms);
    this.runDue();
  }

  /** Execute callbacks whose due time has been reached. */
  runDue(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const due = [...this.#tasks.values()]
        .filter((task) => task.dueMs <= this.clock.nowMs())
        .sort((a, b) => (a.dueMs - b.dueMs) || (a.id - b.id));

      for (const task of due) {
        progressed = true;
        if (task.kind === "sleep") {
          this.#tasks.delete(task.id);
          task.sleepResolve?.();
          continue;
        }
        if (task.kind === "timeout") {
          this.#tasks.delete(task.id);
          task.callback?.();
          continue;
        }
        if (task.kind === "interval") {
          task.callback?.();
          if (this.#tasks.has(task.id)) {
            task.dueMs += task.intervalMs ?? 0;
          }
          continue;
        }
      }
    }
  }

  pendingCount(): number {
    return this.#tasks.size;
  }
}

/** Convenience factory for paired fake clock + scheduler. */
export function createFakeTime(startMs = 0): {
  clock: FakeClock;
  scheduler: FakeScheduler;
} {
  const clock = new FakeClock(startMs);
  return { clock, scheduler: new FakeScheduler(clock) };
}
