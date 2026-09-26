"use client";

import { useEffect, useState } from "react";

const COARSE_QUERY = "(hover: none) and (pointer: coarse)";

/**
 * True on a touch-first device (no hover, coarse pointer). Hover-driven
 * Affordances need a tap-driven twin there (#141). SSR and the first client
 * render report false; the value settles after mount.
 */
export function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(COARSE_QUERY);
    const update = () => setIsCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isCoarse;
}
