// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";

interface CountUpProps {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

/** Animated number that springs from its previous value to the next on change. */
export function CountUp({
  value,
  decimals = 0,
  duration = 0.9,
  prefix = "",
  suffix = "",
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const format = (n: number) =>
      `${prefix}${n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`;

    if (reduce) {
      node.textContent = format(value);
      fromRef.current = value;
      return;
    }

    const controls = animate(fromRef.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(latest) {
        node.textContent = format(latest);
      },
    });
    fromRef.current = value;
    return () => controls.stop();
  }, [value, decimals, duration, prefix, suffix, reduce]);

  return <span ref={ref} className={className} />;
}
