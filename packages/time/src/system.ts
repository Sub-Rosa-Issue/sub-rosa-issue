import type { Clock, Scheduler, TimeContext, TimerHandle } from "./types.js";

/** Production clock backed by the system wall clock. */
export const systemClock: Clock = {
  nowMs: () => Date.now(),
  nowSeconds: () => Math.floor(Date.now() / 1000),
  toISOString(atMs?: number) {
    return new Date(atMs ?? Date.now()).toISOString();
  },
};

type NativeTimer = ReturnType<typeof setTimeout>;

interface TrackedTimer {
  handle: TimerHandle;
  native: NativeTimer;
  kind: "timeout" | "interval";
}

/** Production scheduler using global timer functions. */
export function createSystemScheduler(): Scheduler {
  const tracked = new Map<number, TrackedTimer>();
  let nextId = 1;

  const register = (
    native: NativeTimer,
    kind: "timeout" | "interval",
  ): TimerHandle => {
    const handle: TimerHandle = { id: nextId++ };
    tracked.set(handle.id, { handle, native, kind });
    return handle;
  };

  return {
    sleep(ms, signal) {
      if (ms <= 0) return Promise.resolve();
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }
      return new Promise<void>((resolve, reject) => {
        const native = setTimeout(() => {
          tracked.delete(handle.id);
          cleanup();
          resolve();
        }, ms);
        const handle = register(native, "timeout");

        const onAbort = () => {
          clearTimeout(native);
          tracked.delete(handle.id);
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },

    setTimeout(callback, delayMs) {
      const native = setTimeout(() => {
        tracked.delete(handle.id);
        callback();
      }, delayMs);
      const handle = register(native, "timeout");
      return handle;
    },

    setInterval(callback, intervalMs) {
      const native = setInterval(callback, intervalMs);
      const handle = register(native, "interval");
      return handle;
    },

    clear(handle) {
      const entry = tracked.get(handle.id);
      if (!entry) return;
      if (entry.kind === "timeout") clearTimeout(entry.native);
      else clearInterval(entry.native);
      tracked.delete(handle.id);
    },

    cancelAll() {
      for (const entry of tracked.values()) {
        if (entry.kind === "timeout") clearTimeout(entry.native);
        else clearInterval(entry.native);
      }
      tracked.clear();
    },
  };
}

export const systemScheduler = createSystemScheduler();

export const systemTime: TimeContext = {
  clock: systemClock,
  scheduler: systemScheduler,
};
