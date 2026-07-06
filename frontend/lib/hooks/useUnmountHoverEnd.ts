"use client";

import { useEffect, useRef } from "react";

/**
 * mouseleave never fires when a hovered element unmounts (filter/page change),
 * which strands hover-driven state in consumers. Wrap the enter/leave handlers
 * with markEnter/markLeave and this hook fires the symmetric hover-end on
 * unmount while hovered.
 */
export function useUnmountHoverEnd(onHoverEnd?: () => void) {
  const isHoveredRef = useRef(false);
  const onHoverEndRef = useRef(onHoverEnd);
  onHoverEndRef.current = onHoverEnd;

  useEffect(() => {
    return () => {
      if (isHoveredRef.current) onHoverEndRef.current?.();
    };
  }, []);

  return {
    markEnter: () => {
      isHoveredRef.current = true;
    },
    markLeave: () => {
      isHoveredRef.current = false;
    },
  };
}
