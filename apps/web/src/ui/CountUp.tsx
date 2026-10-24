// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useRef } from "react";
import { animate } from "framer-motion";
import { usePrefersReducedMotion } from "../lib/reduced-motion";

export interface CountUpProps {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  reducedMotion?: boolean;
}

export function formatCountUpValue(
  value: number,
  options: { decimals?: number; prefix?: string; suffix?: string } = {},
): string {
  const { decimals = 0, prefix = "", suffix = "" } = options;
  return `${prefix}${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
}

/** Animated number that springs from its previous value to the next on change. */
export function CountUp({
  value,
  decimals = 0,
  duration = 0.9,
  prefix = "",
  suffix = "",
  className,
  reducedMotion,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const reduce = usePrefersReducedMotion(reducedMotion);
  const formattedTarget = formatCountUpValue(value, { decimals, prefix, suffix });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduce) {
      node.textContent = formattedTarget;
      fromRef.current = value;
      return;
    }

    const controls = animate(fromRef.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(latest) {
        node.textContent = formatCountUpValue(latest, { decimals, prefix, suffix });
      },
    });
    fromRef.current = value;
    return () => controls.stop();
  }, [value, decimals, duration, prefix, suffix, reduce, formattedTarget]);

  return (
    <span
      ref={ref}
      className={className}
      data-reduced-motion={reduce ? "true" : "false"}
    >
      {formattedTarget}
    </span>
  );
}
