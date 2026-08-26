// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const COLORS = ["#6ef5b0", "#3dd68c", "#ffd36a", "#b18cff", "#f6f1e6", "#5be0ff"];

interface Particle {
  id: number;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  color: string;
  shape: "rect" | "circle";
}

interface Burst {
  id: number;
  particles: Particle[];
}

function makeBurst(id: number, count: number): Burst {
  const particles: Particle[] = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * (i / count)) * 2 + Math.random() * 0.6;
    const distance = 120 + Math.random() * 220;
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 80,
      rotate: Math.random() * 720 - 360,
      scale: 0.6 + Math.random() * 0.9,
      color: COLORS[i % COLORS.length],
      shape: Math.random() > 0.5 ? "rect" : "circle",
    };
  });
  return { id, particles };
}

/**
 * Fires a celebratory confetti burst from the screen center whenever `fire`
 * increments. Render once near the app root.
 */
export function ConfettiBurst({ fire, count = 80 }: { fire: number; count?: number }) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seq = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (fire <= 0 || reduce) return;
    const id = ++seq.current;
    setBursts((prev) => [...prev, makeBurst(id, count)]);
    const timeout = window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [fire, count, reduce]);

  if (reduce) return null;

  return (
    <div className="confetti-layer" aria-hidden="true">
      <AnimatePresence>
        {bursts.map((burst) => (
          <div key={burst.id} className="confetti-origin">
            {burst.particles.map((p) => (
              <motion.span
                key={p.id}
                className={`confetti-piece ${p.shape}`}
                style={{ background: p.color }}
                initial={{ opacity: 1, x: 0, y: 0, scale: p.scale, rotate: 0 }}
                animate={{
                  opacity: [1, 1, 0],
                  x: p.x,
                  y: [p.y, p.y + 240],
                  rotate: p.rotate,
                  scale: p.scale,
                }}
                transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
