import type { Clock } from "./types.js";

/** Deterministic clock for tests — advance without waiting on real time. */
export class FakeClock implements Clock {
  #nowMs: number;

  constructor(startMs = 0) {
    this.#nowMs = startMs;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  nowSeconds(): number {
    return Math.floor(this.#nowMs / 1000);
  }

  toISOString(atMs?: number): string {
    return new Date(atMs ?? this.#nowMs).toISOString();
  }

  /** Set absolute time (ms). */
  set(ms: number): void {
    this.#nowMs = ms;
  }

  /** Advance relative time (ms). */
  advance(ms: number): void {
    this.#nowMs += ms;
  }
}
