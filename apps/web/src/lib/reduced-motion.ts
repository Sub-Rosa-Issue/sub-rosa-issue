// Copyright (c) 2026 Sub Rosa contributors
import { useReducedMotion } from "framer-motion";

export interface MatchMediaEnv {
  matchMedia?(query: string): { matches: boolean };
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Synchronous check for `prefers-reduced-motion: reduce`, with an optional
 * override or injectable environment for deterministic testing.
 */
export function prefersReducedMotion(
  override?: boolean,
  env: MatchMediaEnv | undefined = typeof window !== "undefined" ? window : undefined,
): boolean {
  if (typeof override === "boolean") {
    return override;
  }
  if (env && typeof env.matchMedia === "function") {
    return Boolean(env.matchMedia(REDUCED_MOTION_QUERY)?.matches);
  }
  return false;
}

/**
 * React hook combining framer-motion's reactive `useReducedMotion()` with a
 * synchronous `matchMedia("(prefers-reduced-motion: reduce)")` check so the
 * very first render and effect pass respect reduced-motion preferences.
 */
export function usePrefersReducedMotion(override?: boolean): boolean {
  const framerReduced = useReducedMotion();
  if (typeof override === "boolean") {
    return override;
  }
  if (framerReduced === true) {
    return true;
  }
  return prefersReducedMotion();
}
