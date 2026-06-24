// Bounded retry policy for transient failures in Drand and Soroban operations.
//
// Distinguishes transient errors (timeouts, connection errors, 429, retryable 5xx)
// from terminal contract errors, applying exponential backoff with optional jitter
// to transient failures only. Never retries terminal errors.
//
// Supports test-friendly time injection and avoids actual sleeps in tests.

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFraction: number; // [0, 1) — add random jitter to delay
}

export interface RetryContext {
  operation: string;
  attempt: number;
  delay: number;
  isTerminal: boolean;
}

export interface RetryOptions {
  policy: RetryPolicy;
  operation: string;
  logger?: (msg: string) => void;
  now?: () => number;
  random?: () => number; // [0, 1)
  sleep?: (ms: number) => Promise<void>;
}

export interface ErrorClassification {
  isTransient: boolean;
  reason: string;
}

/**
 * Classify an error as transient or terminal.
 * 
 * Transient (retryable):
 * - Timeouts (Error names with "Timeout", "ETIMEDOUT", etc.)
 * - Connection errors (Error names with "ECONNREFUSED", "ECONNRESET", "ERR_SOCKET", etc.)
 * - 429 (rate limited)
 * - Retryable 5xx (500-599 except 501)
 * 
 * Terminal (never retry):
 * - Contract errors (contract code in message)
 * - 4xx errors (except 429)
 * - Other deterministic failures
 */
export function classifyError(error: unknown): ErrorClassification {
  const msg = errorToString(error);
  const code = errorCode(error);
  const status = errorStatus(error);
  const full = [msg, code, status].filter(Boolean).join(" ");

  // Timeouts are transient
  if (
    /Timeout|ETIMEDOUT|EHOSTUNREACH|timeout|timed out/i.test(full) ||
    /ETIMEDOUT|EHOSTUNREACH|EAI_AGAIN|ESOCKETTIMEDOUT|ECONNABORTED/i.test(String(code))
  ) {
    return { isTransient: true, reason: "timeout" };
  }

  // Connection errors are transient
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ENETUNREACH|ERR_SOCKET|EAI_AGAIN|socket hang up|connection.*refused|connection.*reset|connection timed out/i.test(full)
  ) {
    return { isTransient: true, reason: "connection error" };
  }

  // HTTP 429 (rate limited) is transient
  if (status === 429 || /429|rate.*limit|too.*many.*request/i.test(full)) {
    return { isTransient: true, reason: "rate limited (429)" };
  }

  // Retryable 5xx errors (500-599 except 501)
  if (status && status >= 500 && status <= 599 && status !== 501) {
    return { isTransient: true, reason: `retryable 5xx (${status})` };
  }
  const statusMatch = full.match(/\b(5\d{2})\b/);
  if (statusMatch) {
    const statusCode = parseInt(statusMatch[1], 10);
    if (statusCode !== 501) {
      return { isTransient: true, reason: `retryable 5xx (${statusCode})` };
    }
  }

  // Contract-level validation errors are terminal
  if (/HostError|InvocationError|ValidationError|ContractError|contract.*error/i.test(full)) {
    // But some are idempotent skips, not really terminal — let the caller decide
    // via explicit error name matching
    return { isTransient: false, reason: "contract error (likely terminal)" };
  }

  // 4xx errors (except 429, already handled) are terminal
  if (status && status >= 400 && status < 500 && status !== 429) {
    return { isTransient: false, reason: "client error (4xx)" };
  }
  if (/\b4\d{2}\b/.test(full)) {
    return { isTransient: false, reason: "client error (4xx)" };
  }

  // Unknown errors are assumed terminal to avoid infinite loops
  return { isTransient: false, reason: "unknown/terminal" };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = (error as any).code;
  if (maybe !== undefined && maybe !== null) return String(maybe);
  return undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as any).status ?? (error as any).statusCode ?? (error as any).response?.status;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as any).message);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Calculate the delay (in ms) for the given attempt number using exponential backoff.
 * 
 * delay = base * 2^(attempt-1) * (1 + jitter * random)
 * capped at maxDelay
 */
export function calculateBackoff(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseDelayMs * Math.pow(2, attempt - 1);
  const withJitter = exponential * (1 + policy.jitterFraction * random());
  return Math.min(withJitter, policy.maxDelayMs);
}

/**
 * Execute fn, retrying on transient errors up to policy.maxAttempts.
 * 
 * Never retries terminal errors. Logs operation, attempt, delay, and exhaustion.
 * Tests can inject custom time/sleep functions to avoid actual delays.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    policy,
    logger = () => {},
    now = Date.now,
    random = Math.random,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      logger(`[${options.policy.maxAttempts}] attempt ${attempt}/${policy.maxAttempts}`);
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;
      
      const classification = classifyError(error);
      const ctx: RetryContext = {
        operation: options.operation,
        attempt,
        delay: 0,
        isTerminal: !classification.isTransient,
      };

      if (!classification.isTransient) {
        logger(
          `[${options.operation}] attempt ${attempt}/${policy.maxAttempts}: terminal error, giving up: ${errorToString(error)}`,
        );
        throw error;
      }

      if (attempt === policy.maxAttempts) {
        logger(
          `[${options.operation}] attempt ${attempt}/${policy.maxAttempts}: exhausted retries, giving up: ${errorToString(error)}`,
        );
        throw error;
      }

      const delayMs = calculateBackoff(attempt, policy, random);
      ctx.delay = delayMs;
      logger(
        `[${options.operation}] attempt ${attempt}/${policy.maxAttempts}: transient error (${classification.reason}), retrying in ${delayMs}ms: ${errorToString(error)}`,
      );

      await sleep(delayMs);
    }
  }

  // Should not reach here, but satisfy type checker
  throw lastError || new Error("Retry exhausted with no error");
}

/**
 * Create a default retry policy suitable for Drand and Soroban operations.
 * 
 * - maxAttempts: 5
 * - baseDelayMs: 100
 * - maxDelayMs: 5000
 * - jitterFraction: 0.1 (10% jitter)
 */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitterFraction: 0.1,
  };
}

/**
 * Create a retry policy from environment variables, overriding defaults.
 * 
 * Env vars:
 * - RETRY_MAX_ATTEMPTS (default: 5)
 * - RETRY_BASE_DELAY_MS (default: 100)
 * - RETRY_MAX_DELAY_MS (default: 5000)
 * - RETRY_JITTER_FRACTION (default: 0.1)
 */
function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvFloat(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function retryPolicyFromEnv(defaults = defaultRetryPolicy()): RetryPolicy {
  return {
    maxAttempts: parseEnvInt(process.env.RETRY_MAX_ATTEMPTS, defaults.maxAttempts),
    baseDelayMs: parseEnvInt(process.env.RETRY_BASE_DELAY_MS, defaults.baseDelayMs),
    maxDelayMs: parseEnvInt(process.env.RETRY_MAX_DELAY_MS, defaults.maxDelayMs),
    jitterFraction: Math.max(
      0,
      Math.min(parseEnvFloat(process.env.RETRY_JITTER_FRACTION, defaults.jitterFraction), 0.999),
    ),
  };
}
