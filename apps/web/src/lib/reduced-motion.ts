// Copyright (c) 2026 Sub Rosa contributors

/**
 * Nonessential motion in the web app.
 *
 * Confetti, count-up, and other decorative motion (toasts, phase transitions,
 * seal pulses) stay off when `prefers-reduced-motion: reduce` is set.
 * A null preference means the media query is not known yet, so motion stays on.
 * CSS in `base.css`, `landing.css`, and `feedback.css` applies the same rule
 * to stylesheets that do not go through this helper.
 */
export type NonessentialMotion = "confetti" | "count-up" | "nonessential";

export function motionEnabled(
  _kind: NonessentialMotion,
  prefersReducedMotion: boolean | null | undefined,
): boolean {
  return prefersReducedMotion !== true;
}
