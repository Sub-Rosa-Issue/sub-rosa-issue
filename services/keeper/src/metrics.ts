// Prometheus-style metrics collector for the keeper service.
//
// Exposes counters for round-processing events (seen, revealed, settled,
// failed) and latency histograms (settle duration) in a scrapeable text
// format suitable for Prometheus / OpenMetrics consumers.
//
// The collector is opt-in: only created and wired when KEEPER_METRICS_ENABLE
// is set to true (see serve.ts / createStatusServer).

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Opaque handle returned by {@link createMetricsCollector}. */
export interface MetricsCollector {
  /** Increment `keeper_rounds_seen_total`. */
  incRoundsSeen(n?: number): void;
  /** Increment `keeper_rounds_revealed_total`. */
  incRoundsRevealed(n?: number): void;
  /** Increment `keeper_rounds_settled_total`. */
  incRoundsSettled(n?: number): void;
  /** Increment `keeper_rounds_failed_total`. */
  incRoundsFailed(n?: number): void;

  /** Observe a settle-latency sample (seconds). */
  observeSettleLatency(seconds: number): void;

  /** Render all metrics as Prometheus text-format (content-type: text/plain). */
  render(): string;

  /** Reset all counters and histograms (useful in tests). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Internal histogram buckets (seconds)
// ---------------------------------------------------------------------------

const SETTLE_BUCKETS = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300,
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetricsCollector(): MetricsCollector {
  // Counters
  let roundsSeen = 0;
  let roundsRevealed = 0;
  let roundsSettled = 0;
  let roundsFailed = 0;

  // Histogram for settle latency
  const settleBuckets = new Map<number, number>(
    SETTLE_BUCKETS.map((b) => [b, 0]),
  );
  let settleSum = 0;
  let settleCount = 0;

  function observedBucket(seconds: number): number {
    for (const b of SETTLE_BUCKETS) {
      if (seconds <= b) return b;
    }
    return Infinity;
  }

  // ------------------------------------------------------------------
  // Render helpers (Prometheus exposition format)
  // ------------------------------------------------------------------
  function renderCounter(
    name: string,
    help: string,
    value: number,
  ): string {
    return [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} counter`,
      `${name} ${value}`,
    ].join("\n");
  }

  function renderHistogram(
    name: string,
    help: string,
    buckets: Map<number, number>,
    sum: number,
    count: number,
  ): string {
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} histogram`,
    ];
    const base = name;

    let cumulative = 0;
    for (const [le, c] of buckets) {
      cumulative += c;
      const leStr = le === Infinity ? "+Inf" : `${le}`;
      lines.push(`${base}_bucket{le="${leStr}"} ${cumulative}`);
    }
    lines.push(`${base}_bucket{le="+Inf"} ${count}`);
    lines.push(`${base}_sum ${sum}`);
    lines.push(`${base}_count ${count}`);
    return lines.join("\n");
  }

  const collector: MetricsCollector = {
    incRoundsSeen(n = 1) {
      roundsSeen += n;
    },

    incRoundsRevealed(n = 1) {
      roundsRevealed += n;
    },

    incRoundsSettled(n = 1) {
      roundsSettled += n;
    },

    incRoundsFailed(n = 1) {
      roundsFailed += n;
    },

    observeSettleLatency(seconds: number) {
      settleCount++;
      settleSum += seconds;
      const bucket = observedBucket(seconds);
      if (settleBuckets.has(bucket)) {
        settleBuckets.set(bucket, settleBuckets.get(bucket)! + 1);
      }
      // else: above highest bucket → le="+Inf" covers it via cumulative sum
    },

    render(): string {
      const parts: string[] = [];

      if (roundsSeen > 0) {
        parts.push(renderCounter(
          "keeper_rounds_seen_total",
          "Total number of rounds observed by the keeper.",
          roundsSeen,
        ));
      }
      if (roundsRevealed > 0) {
        parts.push(renderCounter(
          "keeper_rounds_revealed_total",
          "Total number of rounds on which the keeper performed reveals.",
          roundsRevealed,
        ));
      }
      if (roundsSettled > 0) {
        parts.push(renderCounter(
          "keeper_rounds_settled_total",
          "Total number of rounds settled by the keeper.",
          roundsSettled,
        ));
      }
      if (roundsFailed > 0) {
        parts.push(renderCounter(
          "keeper_rounds_failed_total",
          "Total number of rounds where a keeper tick failed.",
          roundsFailed,
        ));
      }
      if (settleCount > 0) {
        parts.push(renderHistogram(
          "keeper_settle_duration_seconds",
          "Latency of settle operations in seconds.",
          settleBuckets,
          settleSum,
          settleCount,
        ));
      }

      return parts.join("\n\n") + "\n";
    },

    reset() {
      roundsSeen = 0;
      roundsRevealed = 0;
      roundsSettled = 0;
      roundsFailed = 0;
      settleBuckets.forEach((_, k) => settleBuckets.set(k, 0));
      settleSum = 0;
      settleCount = 0;
    },
  };

  return collector;
}
