"use client";

import { useEffect, useRef, useState } from "react";

/**
 * rAF tweens for eval feedback (score roll, Team Shape morph).
 * Honest by construction: tweens only run between two real engine results —
 * the displayed value always converges on exactly what the engine returned.
 * `prefers-reduced-motion` snaps instantly.
 */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tween an array of values toward `targets` over `duration` ms.
 * Null entries (and the very first non-null targets) snap without animating.
 */
export function useTweenedValues(
  targets: (number | null)[] | null,
  duration: number,
): (number | null)[] | null {
  const [display, setDisplay] = useState<(number | null)[] | null>(targets);
  const displayRef = useRef(display);
  displayRef.current = display;
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);

    const from = displayRef.current;
    if (
      targets == null ||
      from == null ||
      from.length !== targets.length ||
      prefersReducedMotion() ||
      duration <= 0
    ) {
      setDisplay(targets);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      setDisplay(
        targets.map((target, i) => {
          const origin = from[i];
          if (target == null || origin == null) return target;
          return origin + (target - origin) * eased;
        }),
      );
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // Retween only when the target values themselves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets == null ? "null" : targets.join(","), duration]);

  return display;
}

/** Tween a single number toward `target`. Null snaps. */
export function useTweenedNumber(target: number | null, duration: number): number | null {
  const wrapped = useTweenedValues(
    target == null ? null : [target],
    duration,
  );
  return wrapped?.[0] ?? null;
}
